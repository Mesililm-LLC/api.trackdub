# api.trackdub: Cloudflare → AWS migration plan

Status: **scaffold built on branch `aws/fargate-scaffold`, nothing deployed.** Chosen direction (2026-10-21): ECS Fargate for compute, RDS PostgreSQL for data, move the API, the activation service, and data off Cloudflare.

Built so far (branch `aws/fargate-scaffold`, nothing deployed):

- [Dockerfile](../../Dockerfile) and container entry ([server/](../../server)): one image, `SERVICE=api|activation`, `/healthz`, a migration runner, and a database bootstrap script.
- **Application port, done and tested:** Drizzle moved from D1 (SQLite) to PostgreSQL (`migrations/portal`, `migrations/activation`); the raw activation SQL is ported with a per-license row lock so seat limits hold under concurrent requests; `MEDIA` moved from R2 to an S3-backed `ObjectStore`. Unit tests run on an in-process PostgreSQL (163 portal + 27 activation); a real-PostgreSQL concurrency suite (`bun run test:integration`) proves the lock (with it disabled, 25 of 25 racing requests got a seat on a 3-seat license).
- A CDK app ([infra/](../../infra/README.md)) that synthesizes registry, network, data, and service stacks for staging and production.

Data export/import tooling is built and rehearsed against the real Cloudflare data (see Data migration). Still to do: the deploy itself and the DNS cutover.

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

All of this is done on the branch except where marked.

1. **Runtime.** `server/main.ts` serves the Hono apps under Bun (`/healthz` for the ALB). `src/index.ts` and `src/activation/index.ts` are unchanged apart from types.
2. **Database.** Drizzle uses `pg-core`; the driver is postgres.js (`server/postgres.ts`). Tests use PGlite behind the same interfaces (`src/platform/sql.ts`). Migrations were regenerated for PostgreSQL.
3. **Raw SQL in activation.** Statements are ported (`$n` placeholders, `ON CONFLICT`, explicit casts, `COUNT(*)::int`). **Concurrency changed:** SQLite serialized writes, so a count predicate inside one statement was enough. PostgreSQL does not, so every seat change takes a `FOR UPDATE` lock on the license row inside a transaction. Without it, concurrent activations oversubscribe a license.
4. **Object storage.** `MEDIA` is an `ObjectStore` (`src/platform/objects.ts`) backed by S3 (`server/s3.ts`); tests use an in-memory store.
5. **Config.** The app still validates configuration on first request. In AWS the values come from the task definition and Secrets Manager.
6. **Logging.** The existing JSON logger writes to stdout (CloudWatch Logs).
7. **Tests.** The workerd pool is gone for these suites. Existing tests keep their `cloudflare:test` import, aliased to a Node support module.
8. **Not done:** wiring migrations into a pipeline, and pinning the RDS CA for TLS verification.

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

Tooling is built and rehearsed: `server/d1-migrate.ts` (`bun run d1:export`, `bun run d1:import`). **What is actually in Cloudflare** (read-only check, 2026-10-21):

| Database | Contents |
| --- | --- |
| Portal D1 (`trackdub_api`, prod) | **Empty**: 0 users, sessions, accounts, verifications. Only migration 0000 applied (no `dub_jobs` table), so the deployed Worker is also missing the dub job schema. |
| Activation D1 (prod) | 4 licenses (3 active, 1 revoked), 4 activations (3 active, 1 released) |
| Activation D1 (staging) | 6 licenses (4 active, 2 revoked), 5 activations (3 active, 2 released) |
| R2 `trackdub-media` | Not listable with the available token. Almost certainly empty (no user exists to have uploaded, and uploads are disabled), but **unverified**; check before cutover. |

So the only data that matters is the activation licenses and seats. The portal starts fresh: after cutover, re-seed the first operator with `POST /api/admin/invite` (README).

**How it works**
- `export <source> <dir>` reads a D1 database through Cloudflare's query API using only `SELECT`, with columns listed explicitly (a drifted schema fails loudly). Sources: `portal`, `activation`, `activation-staging`.
- `import <source> <dir> [--dry-run]` loads the files into the PostgreSQL database named by `DATABASE_*` in **one transaction**, converts types, then reads every table back and compares row counts and an order-independent content digest with the source. It commits only if everything matches. It refuses a non-empty target, and refuses if `DATABASE_NAME` is not the database that source belongs in. `--dry-run` does all of it and rolls back.
- Conversions: epoch milliseconds → `timestamptz`; SQLite `datetime('now')` text (UTC, no zone marker, used by `licenses.created_at`) is tagged as UTC rather than read as local time; ISO-8601 text → `timestamptz`; `0/1` → `boolean`.

**Rehearsal result** (real Cloudflare data into a real local PostgreSQL, via the CLI): the prod activation export imported with all digests matching, and an independent field-by-field cross-check (key hash lookup, tier/status/seat cap, exact timestamp instants, active fingerprints per license) found 0 mismatches. Dry run left the target empty; a second import was refused. The exported files were deleted afterwards.

**Cutover procedure**
1. Run `bootstrap-db` and `migrate` on the target (infra/README.md), so the schema exists and is empty.
2. Announce a short activation window, then export again (the data changes between rehearsal and cutover).
3. `import ... --dry-run` against the real RDS database, then the real import. Use the Cloudflare account id `21cac5947e11018d571c18792118b8b0` and an API token with D1 read access.
4. Spot-check a few real licenses through `POST /status` on the new service (the plaintext keys are not stored anywhere; use keys from the customer records you hold).
5. Delete the exported files: they contain buyer emails and license key hashes (and, for the portal, password hashes and session tokens).
6. Copy media only if the R2 bucket turns out to hold objects: `rclone sync` between R2 and S3 with the same keys.

**Seats and tokens:** activations migrate as rows, so a license with an active seat on Cloudflare has the same seat on AWS. Tokens already on desktops stay valid as long as `SIGNING_KEY` / `SIGNING_KEY_ID` are unchanged.

## Cutover

1. Stand up staging on AWS and run the full test suite against it.
2. Freeze writes briefly on the Cloudflare side (or announce a window for activation, since desktop clients call it).
3. Final D1 export → Postgres import (`bun run d1:export` / `d1:import`, with a dry run first). Verify.
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
