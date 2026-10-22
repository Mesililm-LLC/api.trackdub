# trackdub-api

**api.trackdub.com** — backend for the Trackdub portal. Better Auth + PostgreSQL +
Drizzle + Hono, running as a container on AWS (ECS Fargate). This repo owns
authentication, authorization, and API routing. The portal (`portal.trackdub.com`)
is a browser-only SPA that talks to this API with `credentials: "include"`; no
backend logic lives in the portal.

> **Hosting:** the portal API targets **AWS** (see [docs/plans/aws-migration.md](docs/plans/aws-migration.md)
> and [infra/README.md](infra/README.md)). The Cloudflare Workers deployment on
> `main` stays live until cutover. **License activation** (`src/activation/`,
> `activate.trackdub.com`) and the **docs-RAG** Worker (`src/docs-rag/`) stay on
> Cloudflare and are not part of the container.

> **Scope:** Auth, health, version, languages, admin invite, and the **dubs job
> scaffold** (`/api/dubs*`: upload to object storage, create/list/get/cancel
> Queued jobs). Billing, keys, webhooks, and the real cloud dub pipeline worker
> are still later work. Jobs do **not** auto-complete.

## Stack

- **Hono** app (`src/index.ts`), served from `server/main.ts`
- **Better Auth** — email/password, invite-only, host-only session cookies
- **PostgreSQL** (RDS in AWS) via **Drizzle ORM** + Drizzle Kit migrations
- **S3** — media uploads for `/api/dubs/upload`
- **Zod** for config + request validation
- **Vitest** — portal tests run in Node against an in-process PostgreSQL ([PGlite](https://pglite.dev)); the activation Worker's tests still run in workerd

## Layout

```
src/
  index.ts          Portal API app: middleware chain + route mounting
  config/env.ts     Fail-fast config validation (secrets / public / bindings)
  auth/             Better Auth factory + invite provisioning
  db/               Drizzle client type + Better Auth / dub job schema
  platform/         SqlDatabase and ObjectStore interfaces the app depends on
  middleware/       request-id, logging, error, auth, authorize, validate
  routes/           health, version, languages, admin (invite), dubs
  lib/              logger, errors, crypto, static languages
  activation/       License activation Worker (Cloudflare, D1) — not part of the container
  docs-rag/         Docs search MCP Worker (Cloudflare) — not part of the container
server/             Container runtime: entrypoint, postgres.js + S3 drivers, migrate, bootstrap
migrations/portal/  Generated PostgreSQL migrations
infra/              AWS CDK app (see infra/README.md)
drizzle/            Legacy portal D1 (SQLite) migrations
drizzle-activation/ Activation Worker D1 migrations (live)
test/               Portal tests (PGlite); test/activation runs in workerd
docs/               ARCHITECTURE.md, CONTRACT-MISMATCHES.md, ACTIVATION-CONTRACT.md, plans/
```

## Environment variables

See [.dev.vars.example](.dev.vars.example) for the full list. In AWS the public
values come from the ECS task definition and secrets from Secrets Manager
(wired in `infra/lib/service-stack.ts`).

| Name                              | Kind    | Notes |
| --------------------------------- | ------- | ----- |
| `APP_ENV`                         | public  | `development` \| `staging` \| `production` |
| `PORTAL_ORIGIN`                   | public  | Exact portal origin, e.g. `https://portal.trackdub.com`. Drives CORS + trustedOrigins. |
| `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | public / secret | PostgreSQL connection. `DATABASE_SSL=disable` for local development only. |
| `MEDIA_BUCKET`, `AWS_REGION`      | public  | S3 bucket for uploads. Credentials come from the task role. |
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
bun run test:all                     # portal (PGlite) + activation (workerd) suites; no database needed
```

After changing `src/db/schema.ts`, regenerate migrations with
`bun run db:generate` and commit the new files under `migrations/portal/`.

The old portal Worker scripts are kept as `legacy:*` (for example
`legacy:deploy`) until cutover is complete. They no longer work from this branch:
the portal code now expects PostgreSQL and S3 bindings, not D1 and R2.

### Activation Worker (stays on Cloudflare)

`src/activation/` is unchanged by the AWS move. Its scripts are the same as on
`main`: `bun run dev:activation`, `deploy:activation`, `deploy:activation:staging`,
`db:migrate:activation:*`, and `db:generate:activation`. A PostgreSQL port of it
(with the per-license row lock that PostgreSQL needs for seat limits) is preserved
on the `aws/activation-postgres` branch in case it is ever moved.

## Run the container

```bash
docker build -t trackdub-api .
docker run --rm -p 8080:8080 --env-file .env trackdub-api
```

`GET /healthz` is the liveness probe the load balancer uses (no dependencies).
`GET /api/health/ready` checks the database. Run migrations as a one-off task
with the same image: `bun run server/migrate.ts` (applies `migrations/portal`).

## Deploy

Deployment is described in [infra/README.md](infra/README.md): CDK stacks for
the registry, network, data, and service; first-deploy steps for secrets,
database bootstrap, migrations, and DNS. Nothing is deployed from this branch yet.

Verify after a deploy:

```bash
curl https://api.trackdub.com/healthz            # ok
curl https://api.trackdub.com/api/health         # 200 { status: "healthy", ... }, or 503 { status: "degraded", ... } when the database is down
curl https://api.trackdub.com/api/health/ready   # 200 { status: "ready" }, or 503 { status: "unavailable", ... }
curl https://api.trackdub.com/api/version        # 200, build = BUILD_ID, commit = GIT_SHA ("unknown" when unset)
```

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
