/**
 * Typed access to `process` for the container entrypoint. The Workers type
 * definitions used by the rest of the repo do not declare `process`, so the
 * minimal shape needed here is declared locally instead of pulling Node types
 * into the Worker build.
 */
declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

export const processEnv: Record<string, string | undefined> = process.env;

export function exit(code: number): never {
  return process.exit(code);
}
