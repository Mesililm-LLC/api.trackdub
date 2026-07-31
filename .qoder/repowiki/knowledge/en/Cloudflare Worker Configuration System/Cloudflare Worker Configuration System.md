---
kind: configuration_system
name: Cloudflare Worker Configuration System
category: configuration_system
scope:
    - '**'
source_files:
    - src/config/env.ts
    - src/types/env.ts
    - wrangler.jsonc
    - .dev.vars.example
    - src/index.ts
---

The application uses a layered, Zod-validated configuration system tailored for Cloudflare Workers. Configuration is split into three categories — secrets, public variables, and runtime bindings — and validated lazily on first request with memoization.

**What system/approach is used**
- Runtime environment variables and Cloudflare bindings are consumed via the `env` object passed by the Worker runtime.
- Validation and parsing are performed with **Zod schemas**, producing strongly-typed configuration objects.
- Configuration loading is lazy: `loadConfig()` caches its result in module-level state after the first successful validation, so subsequent calls return the same object without re-parsing.
- A custom `ConfigError` class is thrown when any required variable is missing or fails schema validation, ensuring failures surface early with aggregated, secret-free messages.

**Key files and packages**
- `src/config/env.ts` — Core loader: Zod schemas for secrets and public vars, `loadConfig(env)`, `ConfigError`, and a test helper `__resetConfigCache()`.
- `src/types/env.ts` — TypeScript `Bindings` interface declaring all expected Cloudflare bindings (`DB`, `MEDIA`, `APP_ENV`, `PORTAL_ORIGIN`, `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN`, optional `CF_VERSION_METADATA`) plus per-request `Variables`.
- `wrangler.jsonc` — Wrangler deployment config defining `vars` (public), D1/R2 binding declarations, routes, and compatibility settings.
- `.dev.vars.example` — Template for local development secrets; copied to `.dev.vars` (git-ignored) and populated via `wrangler secret put` for deployments.
- `src/index.ts` — Entry point that calls `loadConfig(c.env)` inside the CORS middleware to build the allowed-origins list per request.

**Architecture and conventions**
- **Secrets vs. public separation**: `secretsSchema` enforces presence and minimum length for `BETTER_AUTH_SECRET` and `ADMIN_API_TOKEN`; `publicSchema` validates `APP_ENV` (enum: development/staging/production, defaulting to production) and `PORTAL_ORIGIN` (must be a valid URL). Secrets are never logged or exposed to clients.
- **Runtime bindings checked by presence only**: `DB` (D1Database) and `MEDIA` (R2Bucket) are asserted to exist but not parsed, since they are runtime objects.
- **Derived configuration**: `allowedOrigins` is computed from `PORTAL_ORIGIN` plus a hardcoded list of local dev origins (`http://localhost:8080`, `http://localhost:5173`, `http://localhost:3000`).
- **Single source of truth for binding types**: The `Bindings` interface in `src/types/env.ts` mirrors what `wrangler.jsonc` declares, keeping TypeScript types and deployment config in sync.
- **Lazy, memoized loading**: `cached` holds the validated `AppConfig` after the first call; `__resetConfigCache()` resets it for tests.

**Conventions and constraints**
- All required env vars must be present at first request; otherwise `ConfigError` is thrown with an aggregated message listing every missing/malformed field.
- `APP_ENV` is restricted to the enum `development | staging | production`; defaults to `production` if omitted.
- `PORTAL_ORIGIN` must be a valid URL string.
- Secrets (`BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN`) must be strings of at least 16 characters.
- Local development secrets go in `.dev.vars` (git-ignored); deployed secrets are set via `wrangler secret put`.
- Bindings declared in `wrangler.jsonc` (`vars`, `d1_databases`, `r2_buckets`) must match the `Bindings` interface shape.