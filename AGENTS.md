# AGENTS.md

## Cursor Cloud specific instructions

Cloudflare Workers API. Local: `bun install --frozen-lockfile`, then `bun run typecheck` / `bun run dev` (`cf dev`).

- The main Worker (`trackdub-api`, `api.trackdub.com`) is configured by `cloudflare.config.ts` and uses the `cf` CLI (`cf dev`, `cf build`, `cf deploy`). `cf` loads `cloudflare.config.ts` with Node.js and does not support Bun as its runtime, so run `cf` itself on Node 22.18+.
- D1 migrations are not part of `cloudflare.config.ts`; apply them with the directory flag:
  `cf d1 migrations apply 073c0238-db61-40d3-b1ee-3e7555493a72 --dir drizzle` (add `--local` for local).
- The activation Workers are selected with modes: `cf dev --mode activation`, `cf deploy --mode activation`, `cf deploy --mode activation-staging`, and `cf dev --mode activation-local`. Their migrations use `--dir drizzle-activation` against `f95337b1-aff5-455d-a0f9-3293211b1727` (prod) / `d694b5d9-3c04-4534-a9cd-6892967fb5ee` (staging).
- Secrets for local/cloud agents: `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN`, `SIGNING_KEY` (see `.dev.vars`; use Cursor Secrets tab for cloud, do not commit).
- The docs-rag Worker still uses its separate Wrangler config (`wrangler.docs-rag.jsonc`).
- Prefer `bun install --frozen-lockfile` over `bun install` so the lockfile stays authoritative.
- `zod` is pinned via `overrides` in `package.json` so `@modelcontextprotocol/sdk` resolves the app's `zod` 3.x instead of a nested zod 4; other deps that require `zod@4.x` (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `better-auth`, `@cloudflare/vitest-pool-workers`) keep their own nested copy — don't widen the override to the whole tree.
