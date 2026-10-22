# trackdub-api

**api.trackdub.com** — backend for the Trackdub portal, plus the desktop license
activation service. Better Auth + PostgreSQL + Drizzle + Hono, running as a
container on AWS (ECS Fargate). This repo owns authentication, authorization,
and API routing. The portal (`portal.trackdub.com`) is a browser-only SPA that
talks to this API with `credentials: "include"`; no backend logic lives in the
portal.

> **Hosting:** this branch targets **AWS** (see [docs/plans/aws-migration.md](docs/plans/aws-migration.md)
> and [infra/README.md](infra/README.md)). The Cloudflare Workers deployment on
> `main` stays live until cutover. The docs-RAG Worker (`src/docs-rag/`) stays on
> Cloudflare.

> **Scope:** Auth, health, version, languages, admin invite, and the **dubs job
> scaffold** (`/api/dubs*`: upload to object storage, create/list/get/cancel
> Queued jobs). Billing, keys, webhooks, and the real cloud dub pipeline worker
> are still later work. Jobs do **not** auto-complete.

## Stack

- **Hono** app (`src/index.ts` portal API, `src/activation/index.ts` activation), served from `server/main.ts`
- **Better Auth** — email/password, invite-only, host-only session cookies
- **PostgreSQL** (RDS in AWS) via **Drizzle ORM** + Drizzle Kit migrations; hand-written SQL for activation seat accounting
- **S3** — media uploads for `/api/dubs/upload`
- **Zod** for config + request validation
- **Vitest** — unit tests run in Node against an in-process PostgreSQL ([PGlite](https://pglite.dev)); concurrency tests run against a real PostgreSQL

One container image serves both services; `SERVICE=api` (default) or
`SERVICE=activation` selects which app runs.

## Layout

```
src/
  index.ts          Portal API app: middleware chain + route mounting
  activation/       License activation app (own routes, schema, seat accounting)
  config/env.ts     Fail-fast config validation (secrets / public / bindings)
  auth/             Better Auth factory + invite provisioning
  db/               Drizzle client type + Better Auth / dub job schema
  platform/         SqlDatabase and ObjectStore interfaces the app depends on
  middleware/       request-id, logging, error, auth, authorize, validate
  routes/           health, version, languages, admin (invite), dubs
  lib/              logger, errors, crypto, static languages
  docs-rag/         Cloudflare Worker (docs search MCP) — not part of the container
server/             Container runtime: entrypoint, postgres.js + S3 drivers, migrate
migrations/         Generated PostgreSQL migrations (portal/, activation/)
infra/              AWS CDK app (see infra/README.md)
drizzle/            Legacy Cloudflare D1 (SQLite) migrations, kept for the data export
test/               Unit tests (PGlite); test/integration needs a real PostgreSQL
docs/               ARCHITECTURE.md, CONTRACT-MISMATCHES.md, ACTIVATION-CONTRACT.md, plans/
```

## Environment variables

See [.dev.vars.example](.dev.vars.example) for the full list. In AWS the public
values come from the ECS task definition and secrets from Secrets Manager
(wired in `infra/lib/service-stack.ts`).

| Name                              | Kind    | Notes |
| --------------------------------- | ------- | ----- |
| `SERVICE`                         | public  | `api` (default) or `activation`. |
| `APP_ENV`                         | public  | `development` \| `staging` \| `production` |
| `PORTAL_ORIGIN`                   | public  | Exact portal origin, e.g. `https://portal.trackdub.com`. Drives CORS + trustedOrigins. |
| `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | public / secret | PostgreSQL connection. `DATABASE_SSL=disable` for local development only. |
| `MEDIA_BUCKET`, `AWS_REGION`      | public  | S3 bucket for uploads (api only). Credentials come from the task role. |
| `BETTER_AUTH_SECRET`              | secret  | ≥16 chars. `openssl rand -base64 32`. Signs sessions. |
| `ADMIN_API_TOKEN`                 | secret  | ≥16 chars. Guards the invite endpoint. |
| `GIT_SHA`, `BUILD_ID`             | public  | Reported by `GET /api/version`. |

Config is validated on first request (`src/config/env.ts`); anything missing or
malformed fails fast with a clear, secret-free error. If `DATABASE_*` or
`MEDIA_BUCKET` are unset, the container still starts and answers `/healthz`, and
every other route reports which binding is missing.

## Develop

```bash
bun install --frozen-lockfile
docker compose up -d                 # PostgreSQL + MinIO (S3-compatible)
cp .dev.vars.example .env            # bun loads .env automatically; fill in secrets
bun run db:migrate                   # apply migrations/portal
bun run dev                          # server/main.ts with --watch
bun run typecheck                    # tsc --noEmit
bun run test:all                     # portal + activation suites (PGlite, no database needed)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bun run test:integration
```

After changing `src/db/schema.ts` or `src/activation/schema.ts`, regenerate
migrations with `bun run db:generate` / `bun run db:generate:activation` and
commit the new files under `migrations/`.

The old Cloudflare Worker scripts are kept as `legacy:*` (for example
`legacy:deploy`) until cutover is complete. They no longer work from this branch:
the code now expects PostgreSQL and S3 bindings, not D1 and R2.

## Run the container

```bash
docker build -t trackdub-api .
docker run --rm -p 8080:8080 --env-file .env trackdub-api         # SERVICE=api
docker run --rm -e SERVICE=activation --env-file .env trackdub-api  # activation
```

`GET /healthz` is the liveness probe the load balancer uses (no dependencies).
`GET /api/health/ready` checks the database. Run migrations as a one-off task
with the same image: `bun run server/migrate.ts` (uses `SERVICE` to pick
`migrations/portal` or `migrations/activation`).

## Deploy

Deployment is described in [infra/README.md](infra/README.md): CDK stacks for
the registry, network, data, and services; first-deploy steps for secrets,
database bootstrap, migrations, and DNS. Nothing is deployed from this branch yet.

Verify after a deploy:

```bash
curl https://api.trackdub.com/healthz            # ok
curl https://api.trackdub.com/api/health         # 200 { status: "healthy", ... }, or 503 { status: "degraded", ... } when the database is down
curl https://api.trackdub.com/api/health/ready   # 200 { status: "ready" }, or 503 { status: "unavailable", ... }
curl https://api.trackdub.com/api/version        # 200, build = BUILD_ID, commit = GIT_SHA ("unknown" when unset)
```

## Moving data from Cloudflare D1

One-time tooling for the cutover (see [docs/plans/aws-migration.md](docs/plans/aws-migration.md)):

```bash
# 1. read-only export of a D1 database to JSON (keep the folder outside the repo)
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... bun run d1:export activation ../d1-export

# 2. rehearse against the target database: loads, verifies, rolls back
DATABASE_HOST=... DATABASE_NAME=trackdub_activation DATABASE_USER=... DATABASE_PASSWORD=... \
  bun run d1:import activation ../d1-export --dry-run

# 3. the real import (one transaction; commits only if every table verifies)
... bun run d1:import activation ../d1-export
```

Sources are `portal`, `activation` and `activation-staging`. The import refuses a
non-empty target or the wrong `DATABASE_NAME`. The exported files hold personal
data and credential material; delete them when done.

## Bootstrap the first user

Registration is invite-only, so seed the first operator with the admin token.
Because there is no email provider by default, pass an initial `password` to
seed directly (subsequent real invites omit `password` and use the reset flow):

```bash
curl -X POST https://api.trackdub.com/api/admin/invite \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@trackdub.com","name":"You","password":"a-strong-initial-password"}'
```

Then sign in from the portal. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the auth flow and [docs/CONTRACT-MISMATCHES.md](docs/CONTRACT-MISMATCHES.md)
for differences discovered against the portal contract.
