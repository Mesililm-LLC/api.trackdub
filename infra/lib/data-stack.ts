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
 * application secrets, and the task security groups that are allowed to reach
 * the database. The task security groups live here (not in the service stack)
 * so the database rule and the service never form a cross-stack cycle.
 *
 * The portal API and the activation service share one RDS instance but use
 * separate databases and separate roles. The activation signing key is only
 * ever wired into the activation service's task definition.
 */
export class DataStack extends Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly mediaBucket: s3.Bucket;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly apiTaskSecurityGroup: ec2.SecurityGroup;
  public readonly activationTaskSecurityGroup: ec2.SecurityGroup;

  public readonly apiDbCredentials: secretsmanager.Secret;
  public readonly activationDbCredentials: secretsmanager.Secret;
  public readonly betterAuthSecret: secretsmanager.Secret;
  public readonly apiAdminToken: secretsmanager.Secret;
  public readonly resendApiKey: secretsmanager.Secret;
  public readonly activationAdminToken: secretsmanager.Secret;
  public readonly activationSigningKey: secretsmanager.Secret;

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
    this.activationTaskSecurityGroup = new ec2.SecurityGroup(this, "ActivationTaskSg", {
      vpc,
      description: `${config.name} activation tasks`,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: `${config.name} PostgreSQL`,
      allowAllOutbound: false,
    });
    dbSecurityGroup.addIngressRule(this.apiTaskSecurityGroup, ec2.Port.tcp(5432), "portal API");
    dbSecurityGroup.addIngressRule(this.activationTaskSecurityGroup, ec2.Port.tcp(5432), "activation");

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

    // Application roles. The migration step creates these roles in PostgreSQL
    // with the generated passwords; the tasks never see the admin credentials.
    const dbRole = (name: string, username: string): secretsmanager.Secret =>
      new secretsmanager.Secret(this, name, {
        description: `PostgreSQL role ${username} (${config.name})`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username }),
          generateStringKey: "password",
          excludePunctuation: true,
          passwordLength: 32,
        },
      });
    this.apiDbCredentials = dbRole("ApiDbCredentials", "trackdub_api_app");
    this.activationDbCredentials = dbRole("ActivationDbCredentials", "trackdub_activation_app");

    // BETTER_AUTH_SECRET must equal the value currently on Cloudflare in
    // production, or every existing session is invalidated at cutover. The
    // generated value is a placeholder: overwrite it with put-secret-value
    // before the first production deploy (see infra/README.md).
    this.betterAuthSecret = new secretsmanager.Secret(this, "BetterAuthSecret", {
      description: `BETTER_AUTH_SECRET (${config.name}). Overwrite in production with the Cloudflare value.`,
    });
    this.apiAdminToken = new secretsmanager.Secret(this, "ApiAdminToken", {
      description: `Portal API ADMIN_API_TOKEN (${config.name})`,
    });
    this.resendApiKey = new secretsmanager.Secret(this, "ResendApiKey", {
      description: `RESEND_API_KEY for password-reset email (${config.name}). Set manually.`,
    });
    this.activationAdminToken = new secretsmanager.Secret(this, "ActivationAdminToken", {
      description: `Activation ADMIN_API_TOKEN (${config.name}). Separate from the portal API token.`,
    });
    // SIGNING_KEY is an ECC P-256 private key (PKCS#8 PEM) and cannot be
    // generated here: it must match the public key already in the desktop
    // trust ring. The generated value is a placeholder that the activation
    // config validation rejects until the real key is stored.
    this.activationSigningKey = new secretsmanager.Secret(this, "ActivationSigningKey", {
      description: `Activation SIGNING_KEY (${config.name}). Set manually from the existing key; never regenerate.`,
    });
  }
}
