# api.trackdub: Cloudflare → AWS migration plan

Status: **scaffold built on branch `aws/fargate-scaffold`, nothing deployed.** Chosen direction (2026-10-21): ECS Fargate for compute, RDS PostgreSQL for data, move the API, the activation service, and data off Cloudflare.

Built so far: [Dockerfile](../../Dockerfile) and container entry ([server/](../../server)), and a CDK app ([infra/](../../infra/README.md)) that synthesizes registry, network, data, and service stacks for staging and production. Still to do: the application port (Drizzle D1 to Postgres, raw SQL in activation, S3 adapter), the data migration, and the deploy.

## Current Cloudflare footprint

| Piece | Cloudflare resource | Code coupling |
| --- | --- | --- |
| Portal API (`trackdub-api`) | Worker on `api.trackdub.com` (custom domain) | Hono app, `src/index.ts` |
| Auth | D1 via `drizzle-orm/d1` | `src/db/client.ts`, `src/auth/index.ts` (Better Auth) |
| Media uploads | R2 binding `MEDIA` | `/api/dubs/upload` |
| Activation (`trackdub-activation`) | Worker on `activate.trackdub.com`, D1 `trackdub_activation(_staging)`, secrets `SIGNING_KEY`, `ADMIN_API_TOKEN` | `src/activation/**`, raw SQL via `c.env.DB.prepare(...)` |
| Docs RAG (MCP) | Worker in `src/docs-rag/`, R2 `CORPUS`, Cloudflare AI Search | `src/docs-rag/corpus.ts`, `mcp.ts`, `index.ts` |

The docs-RAG piece is **not** in the original scope, but it lives in this repo and the Trackdub docs MCP depends on it. Decide its destination explicitly (see open questions).

## Porting work (code)

1. **Runtime.** Replace the Worker `export default` with a Node server entry using `@hono/node-server`. Hono's routes are portable as-is. Add a `Dockerfile` (Bun or Node base image) and a health route for the ALB.
2. **Database.** Switch Drizzle from `drizzle-orm/d1` to `drizzle-orm/node-postgres` (or `postgres-js`). Regenerate migrations under a Postgres dialect. Keep a separate `drizzle-activation` migration set.
3. **Raw SQL in activation.** `src/activation/routes/*.ts` and `lib/seats.ts` use SQLite-flavored `prepare(...)`. Port each statement to Postgres parameters (`$1`, not `?`). The seat-claim atomicity (`COUNT(*) < max_machines` in the same UPDATE/INSERT) must be preserved; re-verify it under concurrent load on Postgres, since the isolation level now matters.
4. **Object storage.** Replace the `MEDIA` R2 binding with the AWS SDK v3 S3 client (`@aws-sdk/client-s3`) against an S3 bucket. Presigned uploads are a reasonable target. Keep the same key layout so existing objects can be copied with `aws s3 sync` or a `rclone` copy from R2 (R2 speaks the S3 API).
5. **Config.** Replace `wrangler.jsonc` vars/secrets with AWS Secrets Manager (or SSM Parameter Store) injected as env vars into the task definition. Keep `src/config/env.ts` validation unchanged, so a missing secret still fails fast at boot rather than at the first request.
6. **Logging.** Replace the Workers logs path with stdout JSON to CloudWatch Logs (the existing `logger` already emits JSON).
7. **Tests.** `@cloudflare/vitest-pool-workers` runs inside `workerd`. Those tests will need a Node/Vitest pool, and the D1/R2 fakes need replacing with a Postgres test container and an S3-compatible fake (e.g. MinIO).

## AWS infrastructure

- **Network:** VPC with public subnets for the ALB and private subnets for tasks and RDS.
- **Compute:** ECS Fargate service (`trackdub-api`, `trackdub-activation`) behind an ALB, with HTTPS via ACM. Separate target groups and host rules for `api.trackdub.com` and `activate.trackdub.com`.
- **Database:** RDS PostgreSQL or Aurora (one cluster per environment), in private subnets, with automated backups and PITR. Separate prod and staging clusters, matching the current prod/staging split.
- **Storage:** S3 buckets for media (and the docs corpus if it moves).
- **Secrets:** Secrets Manager entries for `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN`, `SIGNING_KEY`, and the DB URL. Nothing in the image or task definition.
- **DNS:** the account has no Route 53 hosted zones, and `trackdub.com` is on Cloudflare DNS, so DNS stays there. Steps: add the ACM DNS-validation CNAMEs in Cloudflare, then at cutover remove the Workers Custom Domain from each Worker (it owns the record) and create a DNS-only (grey cloud) CNAME to the ALB. Proxying through Cloudflare can be considered later.
- **Account state (checked 2026-10-21, profile `trackdub-admin`, account 254587346070, default region us-east-1):** no ECS clusters, RDS instances, or Route 53 zones. Existing stacks are unrelated (`trackdub-chatbot`, `trackdub-website`, `coderag`, `aws-sam-cli-managed-default`, others). No `CDKToolkit` stack, so `cdk bootstrap` is needed once. The `cdk` CLI is not installed locally; use `npx aws-cdk`.
- **IaC:** AWS CDK in TypeScript, in an `infra/` directory of this repo. Reasons: the repo is already TypeScript, `aws-ecs-patterns` gives an ALB-fronted Fargate service in a few lines, Secrets Manager and RDS wiring are first-class, and there is no separate state backend to run. Terraform would only win if you expect non-AWS resources (Cloudflare DNS, Docs RAG) to be managed in the same tool; the Cloudflare side is staying as-is, so that does not apply.
- **Account and access:** one AWS account, authenticated with `aws sso login --profile trackdub-admin`. Prod and staging are separate VPCs (separate CDK stacks) in that account, each with its own RDS, S3 bucket, ECS cluster, and secrets.

## Data migration (D1 → Postgres)

1. Export D1 with `wrangler d1 export` (SQL dump) for `trackdub_api` and both activation databases.
2. Transform the SQLite dump to Postgres DDL and data (types, `AUTOINCREMENT` → identity, boolean and timestamp handling). Drizzle-generated Postgres migrations are the target schema; load data after the schema, not before.
3. Load into staging RDS first, then run the verification queries below.
4. **Auth users and sessions:** Better Auth tables move with the data. Sessions will be invalidated if `BETTER_AUTH_SECRET` changes, so keep the existing secret.
5. **Activation seats and licenses:** these must move exactly. A license that has an active seat on the old system must have the same seat on the new one, or the desktop app will show an unexpected activation limit.

Verification: row counts per table on both sides, a checksum of `licenses` and `activations`, and a sample of 20 license keys checked through `/status` before and after.

## Cutover

1. Stand up staging on AWS and run the full test suite against it.
2. Freeze writes briefly on the Cloudflare side (or announce a window for activation, since desktop clients call it).
3. Final D1 export → Postgres import. Verify.
4. Switch DNS for `activate.trackdub.com` first (the desktop clients depend on it), then `api.trackdub.com`.
5. Keep the Cloudflare Workers deployed but unrouted for 2 weeks as a rollback path. Rollback = point DNS back.
6. Decommission the Workers, D1 databases, and R2 bucket only after the rollback window.

**Desktop trust ring note:** the desktop build pins `issuer` and `activationEndpoint` (see `docs/ACTIVATION-CONTRACT.md`). Keeping the same hostnames (`activate.trackdub.com`) is required; changing them requires a new desktop release. `SIGNING_KEY` and `SIGNING_KEY_ID` must be carried over unchanged, or every issued license will fail verification.

## Open questions

Decided 2026-10-21: **Docs RAG stays on Cloudflare** (R2 corpus + AI Search). It remains a separate Worker and is out of scope for this migration. **IaC is CDK (TypeScript).** **Environments are separate VPCs in one account** (`trackdub-admin` SSO profile).

1. **Cost:** Fargate tasks + ALB + RDS run a fixed monthly floor that Workers did not. Confirm that floor is acceptable for the current traffic level.

## Verification checklist

- `GET /api/health` returns 200 on both hosts, with `availablePipelines` as expected.
- Sign-in, session, and sign-out work from the portal.
- Activation: activate, deactivate, reactivate, and status for a known license, on staging and then prod.
- Media upload round-trips through S3.
- Seat limit enforced under concurrent activation (two clients racing for the last seat).
- Logs appear in CloudWatch with request IDs.
