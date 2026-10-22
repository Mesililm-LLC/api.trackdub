import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import type { EnvConfig } from "./config";

export interface DataStackProps extends StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
}

/**
 * Stateful resources for one environment: PostgreSQL, the media bucket, the
 * application secrets, and the security groups for the load balancer, the API
 * tasks, and the database. The security groups live here (not in the service
 * stack) so the rules between them never form a cross-stack cycle.
 */
export class DataStack extends Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly mediaBucket: s3.Bucket;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly apiTaskSecurityGroup: ec2.SecurityGroup;

  public readonly apiDbCredentials: secretsmanager.Secret;
  public readonly betterAuthSecret: secretsmanager.Secret;
  public readonly apiAdminToken: secretsmanager.Secret;
  public readonly resendApiKey: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    const isProd = config.name === "production";

    this.albSecurityGroup = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: `${config.name} public load balancer`,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP (redirects to HTTPS)");

    this.apiTaskSecurityGroup = new ec2.SecurityGroup(this, "ApiTaskSg", {
      vpc,
      description: `${config.name} portal API tasks`,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: `${config.name} PostgreSQL`,
      allowAllOutbound: false,
    });
    dbSecurityGroup.addIngressRule(this.apiTaskSecurityGroup, ec2.Port.tcp(5432), "portal API");

    this.database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(config.db.instanceClass),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      databaseName: "trackdub_api",
      credentials: rds.Credentials.fromGeneratedSecret("trackdub_admin"),
      allocatedStorage: config.db.allocatedStorageGb,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: config.db.multiAz,
      backupRetention: Duration.days(config.db.backupRetentionDays),
      deletionProtection: config.db.deletionProtection,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT,
      enablePerformanceInsights: true,
      cloudwatchLogsExports: ["postgresql", "upgrade"],
      autoMinorVersionUpgrade: true,
    });

    this.mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    });

    // Application role. The bootstrap step (server/bootstrap-db.ts) creates the
    // PostgreSQL role with this generated password; the tasks never see the
    // admin credentials.
    this.apiDbCredentials = new secretsmanager.Secret(this, "ApiDbCredentials", {
      description: `PostgreSQL role trackdub_api_app (${config.name})`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "trackdub_api_app" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // BETTER_AUTH_SECRET signs sessions. The Cloudflare portal database has no
    // users or sessions today (checked 2026-10-21), so a generated value is
    // fine.
    this.betterAuthSecret = new secretsmanager.Secret(this, "BetterAuthSecret", {
      description: `BETTER_AUTH_SECRET (${config.name})`,
    });
    this.apiAdminToken = new secretsmanager.Secret(this, "ApiAdminToken", {
      description: `Portal API ADMIN_API_TOKEN (${config.name})`,
    });
    this.resendApiKey = new secretsmanager.Secret(this, "ResendApiKey", {
      description: `RESEND_API_KEY for password-reset email (${config.name}). Set manually.`,
    });
  }
}
