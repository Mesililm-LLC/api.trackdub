/**
 * Typing for the `cloudflare:test` specifier, which vitest aliases to
 * test/support/portal-env.ts or test/support/activation-env.ts depending on
 * the suite. `env` is typed as the union of both suites' bindings; each test
 * narrows it with a cast, as it did against the old workerd pool.
 */
declare module "cloudflare:test" {
  export const env: import("@/types/env").Bindings & import("@/activation/types").ActivationBindings;
}
