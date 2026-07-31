---
kind: build_system
name: Cloudflare Workers Build & Test Pipeline via Wrangler, Drizzle & Vitest
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - wrangler.jsonc
    - drizzle.config.ts
    - vitest.config.ts
    - tsconfig.json
    - test/apply-migrations.ts
---

The project is a Cloudflare Worker backend built entirely with Node.js tooling centered on **Wrangler** as the build and deployment orchestrator. There is no Makefile, Dockerfile, or CI YAML in the repository — the build system lives in `package.json` scripts, `wrangler.jsonc`, and a small set of configuration files.

### What system/approach is used
- **Runtime**: Cloudflare Workers (entry point `src/index.ts`).
- **Build & deploy tool**: Wrangler (`wrangler dev`, `wrangler deploy`, `wrangler d1 migrations apply`, `wrangler types`).
- **TypeScript compilation**: No emitted JS; `tsc --noEmit` is used only for type-checking. Wrangler bundles the worker at deploy time.
- **Database migrations**: Drizzle Kit generates SQL into `./drizzle`; Wrangler applies them against D1 via `wrangler d1 migrations apply`.
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers` runs tests inside the real `workerd` runtime, reading bindings from `wrangler.jsonc` and applying Drizzle migrations to an isolated per-run D1 database.

### Key files and packages
- `package.json` — defines all npm scripts (`dev`, `deploy`, `typecheck`, `test`, `db:generate`, `db:migrate:local|remote`, `cf-typegen`) and declares dependencies (`hono`, `better-auth`, `drizzle-orm`, `zod`) plus dev tooling (`wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `drizzle-kit`, `typescript`).
- `wrangler.jsonc` — worker configuration: entry file, compatibility date/flags, routes, environment variables, D1 database binding (`trackdub_api`), R2 bucket binding (`MEDIA`), and the `migrations_dir` pointing at `./drizzle`.
- `drizzle.config.ts` — Drizzle Kit config using `sqlite` dialect with `d1-http` driver, schema source `./src/db/schema.ts`, output directory `./drizzle`.
- `vitest.config.ts` — sets up the `cloudflareTest` plugin with Miniflare, injects test bindings (including `TEST_MIGRATIONS` read from `./drizzle` at config time), and registers `test/apply-migrations.ts` as a global setup file.
- `tsconfig.json` — strict TypeScript settings targeting ES2022, `noEmit: true`, path alias `@/* → ./src/*`, includes `src`, `test`, and generated `worker-configuration.d.ts`.
- `test/apply-migrations.ts` — global Vitest setup that applies Drizzle migrations to the isolated test D1 before any test runs.

### Architecture and conventions
- **Single-entry worker**: All code ships through `src/index.ts`; Wrangler treats this as the sole bundle target.
- **Environment-driven config**: Runtime values are injected via Wrangler's `vars` and secrets; tests override them in the Miniflare bindings block.
- **Migration-first DB strategy**: Schema changes flow through Drizzle Kit generation → SQL files in `./drizzle` → applied by Wrangler both locally (`--local`) and remotely (`--remote`). Tests consume the same migration artifacts.
- **No transpiled output**: The repo never emits JavaScript; builds are ephemeral, performed by Wrangler at deploy time and by Vitest at test time.
- **Path aliases**: Both TypeScript and Vitest resolve `@/*` to `./src`, keeping imports clean across source and tests.

### Conventions and constraints
- Development server is started via `npm run dev` (Wrangler dev); production deployments use `npm run deploy`.
- Database migrations are generated with `npm run db:generate` and applied with `npm run db:migrate:local` (SQLite) or `npm run db:migrate:remote` (D1).
- Type definitions for Cloudflare bindings are regenerated with `npm run cf-typegen` and included in the TS config.
- Tests run against a real `workerd` runtime with an isolated D1 instance; each test run gets its own fresh database with migrations pre-applied.
- Unhandled rejections from Better Auth internals are suppressed via `dangerouslyIgnoreUnhandledErrors: true` in Vitest so they do not mask real failures.
- No external CI pipeline, Docker image, or Makefile exists in the repository; the entire build/test/deploy surface is expressed through npm scripts and Wrangler.