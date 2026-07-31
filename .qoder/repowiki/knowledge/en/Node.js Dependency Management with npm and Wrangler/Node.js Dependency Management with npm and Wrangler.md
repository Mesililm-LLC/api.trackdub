---
kind: dependency_management
name: Node.js Dependency Management with npm and Wrangler
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - wrangler.jsonc
    - drizzle.config.ts
---

This repository uses the standard Node.js ecosystem for dependency management, centered around `package.json` and a `package-lock.json` lockfile. All third-party packages are declared in two categories: runtime dependencies (`dependencies`) and development-only tooling (`devDependencies`).

**Package manager and lockfile**: Dependencies are managed via npm (inferred from the presence of `package-lock.json`). The lockfile pins exact versions for reproducible installs across environments.

**Runtime dependencies** (`dependencies`):
- `hono` (^4.9.0) — HTTP framework serving as the request router
- `better-auth` (^1.3.10) — authentication library
- `drizzle-orm` (^0.45.2) — TypeScript-first ORM for SQLite/D1
- `zod` (^3.25.0) — runtime schema validation

**Development dependencies** (`devDependencies`):
- `wrangler` (^4.28.0) — Cloudflare Workers CLI for build, dev, and deploy
- `vitest` (^4.1.0) with `@cloudflare/vitest-pool-workers` (^0.18.8) — testing against the real `workerd` runtime
- `drizzle-kit` (^0.31.10) — migration generation and introspection
- `typescript` (^5.9.0) — type checking
- `@cloudflare/workers-types` (^5.20260722.1) — Worker environment type definitions

**Build and deployment tooling**: Wrangler is the central orchestration tool. It compiles TypeScript, bundles the worker, and deploys to Cloudflare. The `wrangler.jsonc` config declares the entry point (`src/index.ts`), compatibility date/flags, D1 database bindings, R2 bucket bindings, and custom domain routes. Drizzle migrations live under `./drizzle` and are applied via `wrangler d1 migrations apply`, keeping schema evolution tied to the same toolchain.

**Script conventions** (`scripts` in `package.json`):
- `dev` / `deploy` — Wrangler-based local development and production deployment
- `typecheck` — TypeScript strict type checking without emitting files
- `test` / `test:watch` — Vitest execution against the workerd runtime
- `db:generate` — Drizzle Kit migration generation from `src/db/schema.ts`
- `db:migrate:local` / `db:migrate:remote` — Apply migrations to local or remote D1 databases
- `cf-typegen` — Generate Cloudflare Worker types for bindings

**Environment and platform constraints**: The `allowScripts` field explicitly permits native scripts for `esbuild`, `workerd`, `sharp`, and platform-specific `@cloudflare/workerd-*` packages, indicating awareness of post-install script security on modern npm. No private registry or vendoring strategy is configured; all packages resolve from the public npm registry.

**Versioning policy**: All dependencies use caret ranges (`^x.y.z`), allowing compatible minor/patch updates while pinning major versions. There is no explicit policy documented in the codebase for how version bumps should be coordinated or reviewed.