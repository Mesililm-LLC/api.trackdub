/**
 * Per-environment settings. Staging and production are separate VPCs in one
 * AWS account (profile `trackdub-admin`); nothing is shared between them
 * except the container registry.
 *
 * Values marked ASSUMPTION were not specified anywhere in the repo and should
 * be confirmed before the first deploy.
 */
export type EnvName = "staging" | "production";

export interface EnvConfig {
  name: EnvName;
  account: string;
  region: string;
  vpcCidr: string;
  /** Public hostnames. DNS stays in Cloudflare, so these are CNAMEs to the ALB. */
  apiHost: string;
  activationHost: string;
  portalOrigin: string;
  /** Matches the desktop trust ring; see wrangler.activation*.jsonc. */
  activation: {
    issuer: string;
    audience: string;
    signingKeyId: string;
    allowDevLicenses: boolean;
  };
  db: {
    instanceClass: "t4g.micro" | "t4g.small" | "t4g.medium";
    multiAz: boolean;
    allocatedStorageGb: number;
    backupRetentionDays: number;
    deletionProtection: boolean;
  };
  service: {
    cpu: number;
    memoryMiB: number;
    minCount: number;
    maxCount: number;
  };
  natGateways: number;
  logRetentionDays: number;
}

export const ACCOUNT = "254587346070";
export const REGION = "us-east-1";

export const STAGING: EnvConfig = {
  name: "staging",
  account: ACCOUNT,
  region: REGION,
  vpcCidr: "10.20.0.0/16",
  // ASSUMPTION: staging API host. activate.trackdub.dev is the existing staging activation host.
  apiHost: "api.trackdub.dev",
  activationHost: "activate.trackdub.dev",
  portalOrigin: "https://portal.trackdub.dev",
  activation: {
    issuer: "https://activate.trackdub.dev",
    audience: "trackdub-license-staging",
    signingKeyId: "trackdub-staging-2026-09",
    allowDevLicenses: true,
  },
  db: {
    instanceClass: "t4g.micro",
    multiAz: false,
    allocatedStorageGb: 20,
    backupRetentionDays: 7,
    deletionProtection: false,
  },
  service: { cpu: 256, memoryMiB: 512, minCount: 1, maxCount: 2 },
  natGateways: 1,
  logRetentionDays: 30,
};

export const PRODUCTION: EnvConfig = {
  name: "production",
  account: ACCOUNT,
  region: REGION,
  vpcCidr: "10.10.0.0/16",
  apiHost: "api.trackdub.com",
  activationHost: "activate.trackdub.com",
  portalOrigin: "https://portal.trackdub.com",
  activation: {
    issuer: "https://activate.trackdub.com",
    audience: "trackdub-license-prod",
    signingKeyId: "trackdub-prod-2026-08b",
    allowDevLicenses: false,
  },
  db: {
    instanceClass: "t4g.small",
    multiAz: true,
    allocatedStorageGb: 50,
    backupRetentionDays: 14,
    deletionProtection: true,
  },
  service: { cpu: 512, memoryMiB: 1024, minCount: 2, maxCount: 4 },
  natGateways: 2,
  logRetentionDays: 90,
};

export const ENVIRONMENTS: EnvConfig[] = [STAGING, PRODUCTION];
