# infra: api.trackdub on AWS

AWS CDK (TypeScript) app for moving the `api.trackdub` portal API from a Cloudflare Worker to **ECS Fargate**, with **RDS PostgreSQL** and **S3**. License activation and docs-RAG are **not** here; they stay Cloudflare Workers. See [docs/plans/aws-migration.md](../docs/plans/aws-migration.md) for the full plan and cutover order.

**Status: nothing has been deployed.** `cdk synth` passes; no stack has been created in AWS. The application code now targets PostgreSQL and S3 (see the repo README); the steps below are what remains to stand it up.

## What it creates

| Stack | Per | Contents |
| --- | --- | --- |
| `Trackdub-Registry` | account | ECR repository `trackdub-api` (immutable tags, scan on push) |
| `Trackdub-<env>-Network` | env | VPC (public / private-with-egress / isolated), NAT, S3 gateway endpoint, REJECT flow logs |
| `Trackdub-<env>-Data` | env | RDS PostgreSQL 16, media S3 bucket, Secrets Manager entries, task and ALB security groups |
| `Trackdub-<env>-Service` | env | ECS cluster, ALB (HTTPS, TLS 1.3 policy), ACM certificate, the `api` Fargate service |

`<env>` is `staging` or `production`. Each is its own VPC in the same account (profile `trackdub-admin`, account `254587346070`, `us-east-1`). Environment settings live in [lib/config.ts](lib/config.ts).

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
   - `BETTER_AUTH_SECRET`: the generated value is fine today, because the Cloudflare portal database has no users or sessions (checked 2026-10-21). If users exist by cutover and you carry their sessions over, it must equal the Cloudflare value or every session is invalidated.
   - `ADMIN_API_TOKEN`: any strong value; it guards the invite endpoint.
   - `RESEND_API_KEY`: optional; leave unset and password-reset mail is logged only.
4. **Bootstrap the database** (once per environment). The RDS instance sits in an isolated subnet, so run this from somewhere that can reach it (an SSM port-forward through a bastion, or a one-off task in the VPC). It creates the `trackdub_api_app` role and the `trackdub_api` database it owns, with `CONNECT` limited to that role:
   ```bash
   BOOTSTRAP_ADMIN_URL="postgres://trackdub_admin:<admin password>@<rds-endpoint>:5432/postgres?sslmode=require" \
   BOOTSTRAP_API_PASSWORD="<ApiDbCredentials password>" \
   bun run server/bootstrap-db.ts
   ```
   The admin password is the RDS-generated secret; the application password comes from the `Data` stack's `ApiDbCredentials` secret. The script is idempotent.
5. **Run migrations** as a one-off ECS task using the service's task definition and overriding the command to `["bun","run","server/migrate.ts"]` (the task already has the database credentials). Do this before the service takes traffic and before every release that changes `migrations/`.
6. **DNS (Cloudflare).** Add the ACM validation CNAME, then create a DNS-only CNAME from `api.trackdub.com` to the `AlbDnsName` stack output. At cutover, remove the Workers Custom Domain from the portal Worker first (it owns the record). `activate.trackdub.com` is untouched.

## Known gaps

- **Nothing to migrate.** The Cloudflare portal database is empty (checked 2026-10-21), so there is no data move for this service; re-seed the first operator with the invite endpoint after cutover. R2 `trackdub-media` could not be listed with the available token and is assumed empty; check it before cutover.
- **Database TLS does not verify the CA.** `DATABASE_SSL` defaults to `require` (encrypted, no certificate check). Pin the RDS CA bundle as a hardening step.
- **Migrations are a manual one-off task**, not a CDK-managed step. Wire it into the deploy pipeline once there is one.
- **Staging API host is an assumption.** `api.trackdub.dev` is used because `activate.trackdub.dev` is the existing staging activation host; confirm before deploying staging.
- **No WAF, no CloudFront.** Add AWS WAF on the ALB if rate limiting or bot protection is needed; Cloudflare no longer sits in front once DNS is DNS-only.
- **Cost floor.** Roughly one ALB, one or two NAT gateways, Fargate tasks, and RDS per environment run all month regardless of traffic. Staging uses one NAT gateway and a single-AZ `t4g.micro`.
- **Single-region.** No cross-region replica or backup copy is configured.
- **Nothing has run in AWS.** The server, migrations and bootstrap were exercised against a real local PostgreSQL, and a production-only dependency install boots the server. The Docker image builds (764 MB, runs as uid 1000) and, with no database configured, answers `/healthz` and reports the missing bindings on every other route; it has not been run against a database in a container, and no task has run on Fargate.
