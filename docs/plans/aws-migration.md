# api.trackdub: Cloudflare → AWS migration plan

Status: **portal API ported and scaffolded on branch `aws/fargate-scaffold`, nothing deployed.** Chosen direction (2026-10-21): ECS Fargate for compute and RDS PostgreSQL for data, for the **portal API only**.

**Decided 2026-10-21: license activation stays on Cloudflare.** The live Worker (`activate.trackdub.com`, D1, deployed since 2026-07-31) is healthy, holds only 4 production licenses, and sits on the desktop trust ring. Moving it means moving the signing key, the pinned hostname, and live license seats for no functional gain, while the portal can move without touching any of that. Docs-RAG also stays on Cloudflare.

A complete PostgreSQL port of activation (per-license `FOR UPDATE` seat lock, verified against a real server: with the lock disabled 25 of 25 racing requests got a seat on a 3-seat license), plus a D1 → PostgreSQL export/import tool rehearsed against the real data, is preserved on branch `aws/activation-postgres` (commit `49eb06d`) in case this is ever revisited.

Built so far (branch `aws/fargate-scaffold`, nothing deployed):

- [Dockerfile](../../Dockerfile) and container entry ([server/](../../server)): the portal API, `/healthz`, a migration runner, and a database bootstrap script.
- **Application port, done and tested:** Drizzle moved from D1 (SQLite) to PostgreSQL (`migrations/portal`); `MEDIA` moved from R2 to an S3-backed `ObjectStore`. Portal tests run on an in-process PostgreSQL (163 tests); the activation Worker's own tests (27) still run in workerd.
- A CDK app ([infra/](../../infra/README.md)) that synthesizes registry, network, data, and service stacks for staging and production.

Still to do: the deploy itself and the DNS cutover.

## Current Cloudflare footprint

| Piece | Cloudflare resource | Destination |
| --- | --- | --- |
| Portal API (`trackdub-api`) | Worker on `api.trackdub.com` (custom domain) | **AWS** (this plan) |
| Auth | D1 `trackdub_api` via `drizzle-orm/d1`, Better Auth | **AWS** (RDS PostgreSQL) |
| Media uploads | R2 binding `MEDIA` | **AWS** (S3) |
| Activation (`trackdub-activation`) | Worker on `activate.trackdub.com`, D1 `trackdub_activation(_staging)`, secrets `SIGNING_KEY`, `ADMIN_API_TOKEN` | **Stays on Cloudflare** |
| Docs RAG (MCP) | Worker in `src/docs-rag/`, R2 `CORPUS`, Cloudflare AI Search | **Stays on Cloudflare** |

## Porting work (code)

All of this is done on the branch except where marked.

1. **Runtime.** `server/main.ts` serves the portal Hono app under Bun (`/healthz` for the ALB).
2. **Database.** Drizzle uses `pg-core`; the driver is postgres.js (`server/postgres.ts`). Tests use PGlite behind the same interfaces (`src/platform/sql.ts`). Migrations were regenerated for PostgreSQL.
3. **Object storage.** `MEDIA` is an `ObjectStore` (`src/platform/objects.ts`) backed by S3 (`server/s3.ts`); tests use an in-memory store.
4. **Config.** The app still validates configuration on first request. In AWS the values come from the task definition and Secrets Manager.
5. **Logging.** The existing JSON logger writes to stdout (CloudWatch Logs).
6. **Tests.** The workerd pool is gone for the portal suite. Existing tests import their runtime environment from a Node support module (`test/support/portal-env.ts`). The activation suite keeps its workerd config.
7. **Not done:** wiring migrations into a pipeline, and pinning the RDS CA for TLS verification.

## AWS infrastructure

- **Network:** VPC with public subnets for the ALB and private subnets for tasks and RDS.
- **Compute:** one ECS Fargate service (`trackdub-api`) behind an ALB, with HTTPS via ACM and a host rule for `api.trackdub.com`.
- **Database:** RDS PostgreSQL in private subnets, with automated backups. Separate prod and staging instances.
- **Storage:** S3 bucket for media.
- **Secrets:** Secrets Manager entries for `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN`, `RESEND_API_KEY`, and the database role credentials. Nothing in the image or task definition.
- **DNS:** the account has no Route 53 hosted zones, and `trackdub.com` is on Cloudflare DNS, so DNS stays there. Steps: add the ACM DNS-validation CNAME in Cloudflare, then at cutover remove the Workers Custom Domain from the portal Worker (it owns the record) and create a DNS-only (grey cloud) CNAME to the ALB. Proxying through Cloudflare can be considered later.
- **Account state (checked 2026-10-21, profile `trackdub-admin`, account 254587346070, default region us-east-1):** no ECS clusters, RDS instances, or Route 53 zones. Existing stacks are unrelated (`trackdub-chatbot`, `trackdub-website`, `coderag`, `aws-sam-cli-managed-default`, others). No `CDKToolkit` stack, so `cdk bootstrap` is needed once.
- **IaC:** AWS CDK in TypeScript, in `infra/`. The repo is already TypeScript, Secrets Manager and RDS wiring are first-class, and there is no separate state backend to run.
- **Account and access:** one AWS account, authenticated with `aws sso login --profile trackdub-admin`. Prod and staging are separate VPCs (separate CDK stacks), each with its own RDS, S3 bucket, ECS cluster, and secrets.

## Data

**There is nothing to migrate for the portal.** A read-only check on 2026-10-21 found the portal D1 (`trackdub_api`) empty: 0 users, sessions, accounts, and verifications, with only migration 0000 applied (the deployed Worker does not even have the dub job table). The R2 bucket `trackdub-media` could not be listed with the available token and is almost certainly empty (no user exists to have uploaded), but that is **unverified**; check before cutover.

After cutover, re-seed the first operator with `POST /api/admin/invite` (see the README). Because no sessions exist, `BETTER_AUTH_SECRET` does not need to match the Cloudflare value.

## Cutover

1. Stand up staging on AWS (infra/README.md) and run the verification checklist against it.
2. Check R2 `trackdub-media` for objects; copy them to S3 with the same keys (`rclone sync`) only if there are any.
3. Remove the Workers Custom Domain for `api.trackdub.com`, then create the DNS-only CNAME to the production ALB. `activate.trackdub.com` is not touched.
4. Seed the first operator and sign in from the portal.
5. Keep the portal Worker deployed but unrouted for 2 weeks as a rollback path. Rollback = point DNS back.
6. Decommission the portal Worker, its D1 database, and the media R2 bucket only after the rollback window.

## Open questions

Decided 2026-10-21: **Docs RAG and license activation stay on Cloudflare.** **IaC is CDK (TypeScript).** **Environments are separate VPCs in one account** (`trackdub-admin` SSO profile).

1. **Cost:** Fargate tasks + ALB + RDS run a fixed monthly floor that Workers did not. Confirm that floor is acceptable for the current traffic level, since the portal currently has no users.
2. **SnapSoft:** their scope is the GPU render tier. Cloudflare still hosts licensing and docs search, so "Trackdub doesn't use Cloudflare" is no longer an accurate thing to tell them.

## Verification checklist

- `GET /api/health` returns 200, with `availablePipelines` as expected.
- Sign-in, session, and sign-out work from the portal.
- Media upload round-trips through S3.
- Logs appear in CloudWatch with request IDs.
- `activate.trackdub.com` still answers (it should be unaffected).
