#!/usr/bin/env bun
import { App } from "aws-cdk-lib";
import { ACCOUNT, ENVIRONMENTS, REGION } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { NetworkStack } from "../lib/network-stack";
import { RegistryStack } from "../lib/registry-stack";
import { ServiceStack } from "../lib/service-stack";

/**
 * Entry point. Synth-only for now: nothing here has been deployed.
 *
 * Context:
 *   -c imageTag=<git sha>        image to run (defaults to "unset" for synth)
 *   -c certificateArn=<arn>      reuse an existing ACM cert instead of creating one
 */
const app = new App();

const imageTag = String(app.node.tryGetContext("imageTag") ?? "unset");
const certificateArn = app.node.tryGetContext("certificateArn") as string | undefined;

const registry = new RegistryStack(app, "Trackdub-Registry", {
  env: { account: ACCOUNT, region: REGION },
});

for (const config of ENVIRONMENTS) {
  const env = { account: config.account, region: config.region };
  const prefix = `Trackdub-${config.name}`;
  const terminationProtection = config.name === "production";

  const network = new NetworkStack(app, `${prefix}-Network`, { env, config, terminationProtection });
  const data = new DataStack(app, `${prefix}-Data`, { env, config, vpc: network.vpc, terminationProtection });
  new ServiceStack(app, `${prefix}-Service`, {
    env,
    config,
    vpc: network.vpc,
    data,
    repository: registry.repository,
    imageTag,
    certificateArn,
    terminationProtection,
  });
}
