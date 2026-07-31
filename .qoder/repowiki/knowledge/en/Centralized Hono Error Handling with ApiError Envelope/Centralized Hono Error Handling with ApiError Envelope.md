---
kind: error_handling
name: Centralized Hono Error Handling with ApiError Envelope
category: error_handling
scope:
    - '**'
source_files:
    - src/lib/errors.ts
    - src/middleware/error.ts
    - src/index.ts
    - test/error.test.ts
---

The Trackdub API uses a centralized, envelope-based error handling system built on Hono's middleware pipeline. All errors are normalized into a consistent JSON shape and never leak internal details to clients.

**System overview**
- A custom `ApiError` class (in `src/lib/errors.ts`) extends `Error` and carries a numeric HTTP status, a machine-readable `code`, an optional `details` payload, and the standard message. Static factory methods (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `internal`) provide typed constructors for common cases.
- Every successful error response is wrapped by `toErrorBody(err, requestId)`, which produces the uniform `{ error: { code, message, requestId, details? } }` envelope documented in the file's JSDoc.
- A single Hono `onError` handler (`src/middleware/error.ts`) is registered once at app bootstrap (`src/index.ts`). It distinguishes three categories:
  1. `ApiError` → logged at warn level (no stack), returned with its original status and code.
  2. `ConfigError` (from `@/config/env`) → logged at error level with full detail, but the client receives a generic 500 via `ApiError.internal()` so configuration specifics never leak.
  3. Any other thrown `Error` → logged at error level with full stack trace server-side; client gets a generic 500 with code `INTERNAL`.
- 404s are handled separately via `app.notFound`, which also uses `toErrorBody(ApiError.notFound(), requestId)` to keep the envelope consistent.

**Architecture and conventions**
- Error-producing code throws `ApiError` instances rather than returning them or using sentinel values. This lets Hono's `onError` catch and normalize everything uniformly.
- Stack traces and internal messages are always logged server-side through the shared `logger` (`@/lib/logger`) and are explicitly excluded from the client response.
- The `requestId` middleware injects a per-request identifier that is propagated into every error envelope, enabling end-to-end tracing across logs and responses.
- Routes and middlewares do not implement their own error formatting — they rely on the central `onError` handler, keeping response shapes consistent across the entire API surface.

**Conventions and constraints**
- Only `ApiError` (and `ConfigError`) are considered "known" errors; anything else is treated as unexpected and mapped to a generic 500.
- Client-facing error bodies must never contain stack traces or internal diagnostic text — enforced by the `onError` handler which strips those fields before responding.
- Every error response includes a `requestId` field, making it possible to correlate client errors with server logs.
- Tests in `test/error.test.ts` assert these invariants: correct status codes, stable error codes (`BAD_REQUEST`, `NOT_FOUND`, `INTERNAL`), presence of `requestId`, inclusion of `details` when provided, and absence of leaked internal messages or stack traces.