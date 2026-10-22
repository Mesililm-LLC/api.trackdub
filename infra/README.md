# infra: api.trackdub on AWS

AWS CDK (TypeScript) app for moving `api.trackdub` and the activation service from Cloudflare Workers to **ECS Fargate**, with **RDS PostgreSQL** and **S3**. See [docs/plans/aws-migration.md](../docs/plans/aws-migration.md) for the full plan and cutover order.

**Status: scaffold only. Nothing has been deployed.** `cdk synth` passes; no stack has been created in AWS.

## What it creates

| Stack | Per | Contents |
| --- | --- | --- |
| `Trackdub-Registry` | account | ECR repository `trackdub-api` (immutable tags, scan on push) |
| `Trackdub-<env>-Network` | env | VPC (public / private-with-egress / isolated), NAT, S3 gateway endpoint, REJECT flow logs |
| `Trackdub-<env>-Data` | env | RDS PostgreSQL 16, media S3 bucket, Secrets Manager entries, task and ALB security groups |
| `Trackdub-<env>-Service` | env | ECS cluster, ALB (HTTPS, TLS 1.3 policy), ACM certificate, `api` and `activation` Fargate services |

`<env>` is `staging` or `production`. Each is its own VPC in the same account (profile `trackdub-admin`, account `254587346070`, `us-east-1`). Environment settings live in [lib/config.ts](lib/config.ts).

The two services run **one image** and differ only by `SERVICE=api|activation` (see [server/main.ts](../server/main.ts)). The activation task is the only one that can read `SIGNING_KEY`.

## Commands

```bash
cd infra
bun install
bun run typecheck
bunx cdk synth --quiet          # synth all stacks, no AWS changes
bunx cdk diff Trackdub-staging-Service -c imageTag=<sha>   # read-only comparison once something is deployed
```

`synth` needs no credentials beyond a profile for the account id; it never creates resources.

## Before the first deploy

These are intentionally not automated. Do them in order:

1. **Bootstrap CDK** once: `bunx cdk bootstrap aws://254587346070/us-east-1 --profile trackdub-admin`. The account has no `CDKToolkit` stack yet.
2. **Deploy `Trackdub-Registry`**, then build and push an image tagged with the commit SHA:
   ```bash
   docker build -t <ecr-uri>:<sha> .
   docker push <ecr-uri>:<sha>
   ```
3. **Set the secrets that cannot be generated** (overwrite the generated placeholders with `aws secretsmanager put-secret-value`):
   - `BETTER_AUTH_SECRET` (production): must equal the current Cloudflare value or every session is invalidated at cutover.
   - Activation `SIGNING_KEY`: the existing ECC P-256 PKCS#8 PEM. Never regenerate; it must match the trust ring baked into desktop builds.
   - `RESEND_API_KEY`: optional; leave unset and password-reset mail is logged only.
4. **Create the application roles and databases** in PostgreSQL using the generated `*DbCredentials` secrets (`trackdub_api_app` on `trackdub_api`, `trackdub_activation_app` on `trackdub_activation`). Run the Postgres migrations from the app port.
5. **DNS (Cloudflare).** Add the ACM validation CNAMEs, then create DNS-only CNAMEs from the API and activation hostnames to the `AlbDnsName` stack output. At cutover, remove the Workers Custom Domain from each Worker first (it owns the record).

## Known gaps

- **The app cannot serve real traffic yet.** [server/bindings.ts](../server/bindings.ts) returns no database or object-store bindings, so only `/healthz` works. The remaining port is Drizzle D1 to Postgres (including the raw SQL in `src/activation/**`) and an S3 adapter for the `MEDIA` surface used by `src/routes/dubs.ts`.
- **Staging API host is an assumption.** `api.trackdub.dev` is used because `activate.trackdub.dev` is the existing staging activation host; confirm before deploying staging.
- **No WAF, no CloudFront.** Add AWS WAF on the ALB if rate limiting or bot protection is needed; Cloudflare no longer sits in front once DNS is DNS-only.
- **Cost floor.** Roughly one ALB, one or two NAT gateways, Fargate tasks, and RDS per environment run all month regardless of traffic. Staging uses one NAT gateway and a single-AZ `t4g.micro`.
- **Single-region.** No cross-region replica or backup copy is configured.
