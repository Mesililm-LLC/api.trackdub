/**
 * Typed access to `process.env` for the container entrypoint. The Workers
 * type definitions used by the rest of the repo do not declare `process`, so
 * the minimal shape needed here is declared locally instead of pulling Node
 * types into the Worker build.
 */
declare const process: { env: Record<string, string | undefined> };

export const processEnv: Record<string, string | undefined> = process.env;
