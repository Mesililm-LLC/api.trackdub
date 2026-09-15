# AGENTS.md

## Linear (agents)

Track work in Linear workspace [trackdubllc](https://linear.app/trackdubllc) under project **Cloud & Portal** (label `repo:api`). Agents must search, create, comment, and status-update Linear issues autonomously as progress is made or new tasks are discovered. Mention `TS-xxx` on PRs once GitHub↔Linear is connected. Never mark Done without honest proof.

Canonical procedure (when present in public core): `docs/operations/linear-workflow.md`.

## Cursor Cloud specific instructions

Cloudflare Workers API. Local: `npm ci`, then `npm run typecheck` / `npm run dev` (`wrangler dev`).

- Secrets for local/cloud agents: `BETTER_AUTH_SECRET`, `ADMIN_API_TOKEN` (see `.dev.vars`; use Cursor Secrets tab for cloud, do not commit).
- Staging/activation workers use separate wrangler configs (`wrangler.activation*.jsonc`).
- Prefer `npm ci` over `npm install` so lockfile stays authoritative.
