---
kind: logging_system
name: Structured JSON Logging via Cloudflare Workers Console
category: logging_system
scope:
    - '**'
source_files:
    - src/lib/logger.ts
    - src/middleware/logging.ts
    - src/middleware/error.ts
---

The application uses a minimal, purpose-built structured logging system that emits one JSON object per line to the Cloudflare Workers console, which routes output to the Cloudflare observability pipeline (Workers Logs / Logpush).

**Framework and implementation**
- The logger lives in `src/lib/logger.ts` and defines four levels: `debug`, `info`, `warn`, `error`. Each call serializes an object with `level`, `message`, `time` (ISO timestamp), and any additional fields into a single JSON line.
- Output is routed through `console.log`, `console.warn`, or `console.error` depending on level; the comment documents that Workers automatically forwards these to the observability pipeline.
- There is no external logging library — the implementation is ~30 lines of TypeScript.

**Structured fields and conventions**
- A shared `LogFields` interface (`requestId`, `method`, `path`, `status`, `durationMs`) plus an open index signature allows callers to attach arbitrary context.
- The middleware in `src/middleware/logging.ts` (`requestLogging`) attaches request-scoped fields (`requestId`, `method`, `path`, `status`, `durationMs`) to every request as an access log entry emitted after the handler runs so status and duration are known.
- Error middleware (`src/middleware/error.ts`) logs client errors at `warn` (without stack traces) and unhandled/server errors at `error` (including full `stack`). Configuration errors are logged at `error` but never leak details to clients.
- Auth flows log events like password-reset requests at `info`; sensitive data such as reset URLs/tokens are only included outside production.

**Security constraints**
- The logger's top-level comment explicitly states it "Never logs secrets or request bodies." Callers follow this by filtering out secrets (e.g., auth reset tokens are omitted in production).
- Stack traces are logged server-side only and never returned to clients.

**Sinks and routing**
- All output goes through the standard `console.*` APIs; Cloudflare Workers handles sink configuration externally (via Wrangler/Cloudflare dashboard). No custom sinks or file writers are implemented in code.