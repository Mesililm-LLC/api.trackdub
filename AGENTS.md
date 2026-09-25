# AGENTS.md

## Cursor Cloud specific instructions

Cloudflare Workers API. Local: `bun install --frozen-lockfile`, then `bun run typecheck` / `bun run dev` (`wrangler dev`).

- Secrets for local/cloud agents: `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN` (see `.dev.vars`; use Cursor Secrets tab for cloud, do not commit).
- Staging/activation workers use separate wrangler configs (`wrangler.activation*.jsonc`).
- Prefer `bun install --frozen-lockfile` over `bun install` so the lockfile stays authoritative.
- `zod` is pinned via `overrides` in `package.json` to keep `@modelcontextprotocol/sdk` resolving the same major version the app code uses (`3.x`); several other deps (`better-auth`, `agents`, `@cloudflare/vitest-pool-workers`) require `zod@4.x` and keep their own nested copy — don't widen the override to the whole tree.
