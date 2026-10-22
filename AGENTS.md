# AGENTS.md

## Cursor Cloud specific instructions

Hono API for AWS (ECS Fargate) backed by PostgreSQL and S3. Local: `bun install --frozen-lockfile`, then `bun run typecheck` / `bun run test:all`. `bun run dev` needs PostgreSQL (`docker compose up -d`).

- Secrets for local/cloud agents: `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN` (see `.dev.vars.example`; use Cursor Secrets tab for cloud, do not commit).
- Unit tests need no database: they run against an in-process PostgreSQL (PGlite). `test/integration` needs `TEST_DATABASE_URL` and skips itself otherwise.
- Seat accounting in `src/activation/lib/seats.ts` relies on a per-license row lock (`FOR UPDATE`); do not remove it. Without it, concurrent activations oversubscribe a license on PostgreSQL.
- Cloudflare: only `src/docs-rag/` (and `wrangler.docs-rag.jsonc`) still deploys as a Worker. The old portal and activation Worker configs (`wrangler.jsonc`, `wrangler.activation*.jsonc`) and the `legacy:*` scripts are kept until cutover is complete.
- Prefer `bun install --frozen-lockfile` over `bun install` so the lockfile stays authoritative.
- `zod` is pinned via `overrides` in `package.json` so `@modelcontextprotocol/sdk` resolves the app's `zod` 3.x instead of a nested zod 4; other deps that require `zod@4.x` (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `better-auth`) keep their own nested copy — don't widen the override to the whole tree.
- Writing files with large shell heredocs that contain quotes can fail in some agent shells; use the editor/Write tool instead.
