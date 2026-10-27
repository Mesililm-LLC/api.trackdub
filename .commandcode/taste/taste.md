# Taste Preferences

## Tooling & Workflow
- Prefers `cf` (Cloudflare CLI) over `wrangler` and wants tooling/commands migrated from wrangler to cf (dev/build/deploy, typegen, D1 migrations). Confidence: 0.95
- Prefers using the cloudflare agent skill and MCP tools for Cloudflare operations (e.g., inspecting Workers, secrets, bindings, accounts) rather than relying on local CLI auth. Confidence: 0.9

## Communication & Working Style
- Extremely terse instructions (e.g. "do it", "if wranglers not available, cf is"), expecting the agent to infer intent and act immediately rather than ask for clarification. Confidence: 0.7
- Wants production failures diagnosed from evidence (logs, stack traces, live resource state via MCP/API) before code changes, not speculative patching. Confidence: 0.7

## Version Control
- Generated build artifacts / synthesized output (e.g., `infra/cdk.out/` from `cdk synth`/`cdk deploy`, `.cloudflare/` types) should be gitignored, and already-staged artifacts removed from the index (`git rm --cached -r`). Confidence: 0.95