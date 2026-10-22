# AGENTS.md

## Cursor Cloud specific instructions

Hono API for AWS (ECS Fargate) backed by PostgreSQL and S3. Local: `bun install --frozen-lockfile`, then `bun run typecheck` / `bun run test:all`. `bun run dev` needs PostgreSQL (`docker compose up -d`).

- Secrets for local/cloud agents: `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN` (see `.dev.vars.example`; use Cursor Secrets tab for cloud, do not commit).
- Portal tests need no database: they run against an in-process PostgreSQL (PGlite). The activation tests (`test/activation`) still run in workerd via `@cloudflare/vitest-pool-workers`.
- License activation (`src/activation/`, D1, `wrangler.activation*.jsonc`) stays a Cloudflare Worker and is not in the container. Its PostgreSQL port, including the per-license `FOR UPDATE` seat lock that PostgreSQL needs, is preserved on branch `aws/activation-postgres`.
- Cloudflare: `src/docs-rag/` and `src/activation/` still deploy as Workers. The old portal Worker config (`wrangler.jsonc`) and the `legacy:*` scripts are kept until cutover is complete.
- Prefer `bun install --frozen-lockfile` over `bun install` so the lockfile stays authoritative.
- `zod` is pinned via `overrides` in `package.json` so `@modelcontextprotocol/sdk` resolves the app's `zod` 3.x instead of a nested zod 4; other deps that require `zod@4.x` (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `better-auth`) keep their own nested copy — don't widen the override to the whole tree.
- Writing files with large shell heredocs that contain quotes can fail in some agent shells; use the editor/Write tool instead.
