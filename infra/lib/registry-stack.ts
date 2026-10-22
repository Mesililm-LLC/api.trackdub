import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import type { Construct } from "constructs";

/**
 * Shared container registry, deployed once and before any service stack so an
 * image can be pushed before ECS tries to pull it. Tags are immutable: every
 * release is pinned to a commit SHA, never `latest`.
 */
export class RegistryStack extends Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, "Repository", {
      repositoryName: "trackdub-api",
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ description: "Keep the 10 most recent images", maxImageCount: 10 }],
    });
  }
}
