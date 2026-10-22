import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { EnvConfig } from "./config";
import type { DataStack } from "./data-stack";

export interface ServiceStackProps extends StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  data: DataStack;
  repository: ecr.IRepository;
  /** Immutable image tag (commit SHA) to run. */
  imageTag: string;
  /** Existing ACM certificate; when omitted a DNS-validated one is created. */
  certificateArn?: string;
}

const CONTAINER_PORT = 8080;

/** Retention values CDK accepts, so the config's day count maps to a real enum member. */
function retentionFor(days: number): logs.RetentionDays {
  return days >= 90 ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH;
}

/**
 * ECS Fargate services behind one internet-facing ALB. Two services run the
 * same image with different `SERVICE` values:
 *   api         portal API         (api.trackdub.*)
 *   activation  license activation (activate.trackdub.*)
 *
 * DNS stays in Cloudflare. After deploy, point each hostname at the ALB with a
 * DNS-only CNAME (see the stack outputs), and add the ACM validation CNAMEs
 * shown in the console if the certificate is created by this stack.
 */
export class ServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const { config, vpc, data, repository, imageTag } = props;

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn)
      : new acm.Certificate(this, "Certificate", {
          domainName: config.apiHost,
          subjectAlternativeNames: [config.activationHost],
          validation: acm.CertificateValidation.fromDns(),
        });

    // Created in the data stack next to the task security groups so the
    // ALB -> task rules CDK adds automatically stay inside one stack.
    const albSecurityGroup = data.albSecurityGroup;

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
    });

    alb.addListener("Http", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
    });
    const https = alb.addListener("Https", {
      port: 443,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "application/json",
        messageBody: JSON.stringify({ error: "not_found" }),
      }),
    });

    const makeService = (opts: {
      name: "api" | "activation";
      host: string;
      priority: number;
      taskSecurityGroup: ec2.ISecurityGroup;
      environment: Record<string, string>;
      secrets: Record<string, ecs.Secret>;
    }): ecs.FargateService => {
      const logGroup = new logs.LogGroup(this, `${opts.name}Logs`, {
        retention: retentionFor(config.logRetentionDays),
      });

      const taskDefinition = new ecs.FargateTaskDefinition(this, `${opts.name}Task`, {
        cpu: config.service.cpu,
        memoryLimitMiB: config.service.memoryMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      taskDefinition.addContainer("app", {
        image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
        essential: true,
        portMappings: [{ containerPort: CONTAINER_PORT }],
        readonlyRootFilesystem: true,
        stopTimeout: Duration.seconds(30),
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: opts.name, logGroup }),
        environment: {
          SERVICE: opts.name,
          PORT: String(CONTAINER_PORT),
          APP_ENV: config.name,
          DATABASE_HOST: data.database.dbInstanceEndpointAddress,
          DATABASE_PORT: data.database.dbInstanceEndpointPort,
          ...opts.environment,
        },
        secrets: opts.secrets,
      });

      const service = new ecs.FargateService(this, `${opts.name}Service`, {
        cluster,
        taskDefinition,
        desiredCount: config.service.minCount,
        securityGroups: [opts.taskSecurityGroup],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
        circuitBreaker: { enable: true, rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        healthCheckGracePeriod: Duration.seconds(30),
      });

      const targetGroup = new elbv2.ApplicationTargetGroup(this, `${opts.name}Targets`, {
        vpc,
        port: CONTAINER_PORT,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [service],
        deregistrationDelay: Duration.seconds(30),
        healthCheck: {
          path: "/healthz",
          interval: Duration.seconds(15),
          timeout: Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      });
      https.addAction(`${opts.name}Route`, {
        priority: opts.priority,
        conditions: [elbv2.ListenerCondition.hostHeaders([opts.host])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });

      service
        .autoScaleTaskCount({ minCapacity: config.service.minCount, maxCapacity: config.service.maxCount })
        .scaleOnCpuUtilization(`${opts.name}Cpu`, { targetUtilizationPercent: 60 });

      return service;
    };

    const apiService = makeService({
      name: "api",
      host: config.apiHost,
      priority: 10,
      taskSecurityGroup: data.apiTaskSecurityGroup,
      environment: {
        PORTAL_ORIGIN: config.portalOrigin,
        DATABASE_NAME: "trackdub_api",
        MEDIA_BUCKET: data.mediaBucket.bucketName,
        AWS_REGION: config.region,
      },
      secrets: {
        BETTER_AUTH_SECRET: ecs.Secret.fromSecretsManager(data.betterAuthSecret),
        ADMIN_API_TOKEN: ecs.Secret.fromSecretsManager(data.apiAdminToken),
        RESEND_API_KEY: ecs.Secret.fromSecretsManager(data.resendApiKey),
        DATABASE_USER: ecs.Secret.fromSecretsManager(data.apiDbCredentials, "username"),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(data.apiDbCredentials, "password"),
      },
    });
    data.mediaBucket.grantReadWrite(apiService.taskDefinition.taskRole);

    makeService({
      name: "activation",
      host: config.activationHost,
      priority: 20,
      taskSecurityGroup: data.activationTaskSecurityGroup,
      environment: {
        DATABASE_NAME: "trackdub_activation",
        ACTIVATION_ISSUER: config.activation.issuer,
        ACTIVATION_AUDIENCE: config.activation.audience,
        SIGNING_KEY_ID: config.activation.signingKeyId,
        ...(config.activation.allowDevLicenses ? { ALLOW_DEV_LICENSES: "true" } : {}),
      },
      secrets: {
        SIGNING_KEY: ecs.Secret.fromSecretsManager(data.activationSigningKey),
        ADMIN_API_TOKEN: ecs.Secret.fromSecretsManager(data.activationAdminToken),
        DATABASE_USER: ecs.Secret.fromSecretsManager(data.activationDbCredentials, "username"),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(data.activationDbCredentials, "password"),
      },
    });

    new CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: `Create DNS-only CNAMEs in Cloudflare: ${config.apiHost} and ${config.activationHost} -> this value`,
    });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
  }
}
