# AGENTS.md

## Cursor Cloud specific instructions

Cloudflare Workers API. Local: `npm ci`, then `npm run typecheck` / `npm run dev` (`wrangler dev`).

- Secrets for local/cloud agents: `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN` (see `.dev.vars`; use Cursor Secrets tab for cloud, do not commit).
- Staging/activation workers use separate wrangler configs (`wrangler.activation*.jsonc`).
- Prefer `npm ci` over `npm install` so lockfile stays authoritative.
