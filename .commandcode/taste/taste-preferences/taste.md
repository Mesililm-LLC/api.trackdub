# Taste Preferences
- Prefers `cf` (Cloudflare CLI) over `wrangler` and wants tooling/commands migrated from wrangler to cf (dev/build/deploy, typegen, D1 migrations). Confidence: 0.95
- Prefers using the cloudflare agent skill and MCP tools for Cloudflare operations (e.g., inspecting Workers, secrets, bindings, accounts) rather than relying on local CLI auth. Confidence: 0.9
- Prefers rollouts staged through a non-production environment first (deploy staging, verify it live, then promote the same change to production). Confidence: 0.6
- Extremely terse instructions (e.g. "do it", "if wranglers not available, cf is", "migrate activation to cf?"), expecting the agent to infer intent and act immediately rather than ask for clarification. Confidence: 0.8
- Comfortable with whole-surface migrations (e.g. all Workers from Wrangler to cf at once) when framed as a short question; prefers the agent investigate existing configs/resources first, then execute end-to-end. Confidence: 0.6
- Wants production failures diagnosed from evidence (logs, stack traces, live resource state via MCP/API) before code changes, not speculative patching. Confidence: 0.7
- Generated build artifacts / synthesized output (e.g., `infra/cdk.out/` from `cdk synth`/`cdk deploy`, `.cloudflare/` types) should be gitignored, and already-staged artifacts removed from the index (`git rm --cached -r`). Confidence: 0.95
