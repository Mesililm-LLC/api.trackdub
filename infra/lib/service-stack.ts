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
 * The portal API as an ECS Fargate service behind an internet-facing ALB
 * (`api.trackdub.*`). License activation and docs-rag are not here; they stay
 * Cloudflare Workers.
 *
 * DNS stays in Cloudflare. After deploy, point the API hostname at the ALB with
 * a DNS-only CNAME (see the stack outputs), and add the ACM validation CNAME
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
          validation: acm.CertificateValidation.fromDns(),
        });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      // Created in the data stack next to the task security group so the
      // ALB -> task rule CDK adds automatically stays inside one stack.
      securityGroup: data.albSecurityGroup,
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

    const logGroup = new logs.LogGroup(this, "ApiLogs", {
      retention: retentionFor(config.logRetentionDays),
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "ApiTask", {
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
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logGroup }),
      environment: {
        PORT: String(CONTAINER_PORT),
        APP_ENV: config.name,
        GIT_SHA: imageTag,
        PORTAL_ORIGIN: config.portalOrigin,
        DATABASE_HOST: data.database.dbInstanceEndpointAddress,
        DATABASE_PORT: data.database.dbInstanceEndpointPort,
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
    data.mediaBucket.grantReadWrite(taskDefinition.taskRole);

    const service = new ecs.FargateService(this, "ApiService", {
      cluster,
      taskDefinition,
      desiredCount: config.service.minCount,
      securityGroups: [data.apiTaskSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(30),
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "ApiTargets", {
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
    https.addAction("ApiRoute", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.hostHeaders([config.apiHost])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    service
      .autoScaleTaskCount({ minCapacity: config.service.minCount, maxCapacity: config.service.maxCount })
      .scaleOnCpuUtilization("ApiCpu", { targetUtilizationPercent: 60 });

    new CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: `Create a DNS-only CNAME in Cloudflare: ${config.apiHost} -> this value`,
    });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
  }
}
