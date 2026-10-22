/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `cloudflare:test`'s `env` is typed as `Cloudflare.Env`. Declare it here so the
// activation tests do not depend on a `wrangler types` run, and add the injected
// migrations array used by the setup hook.
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { ActivationBindings } from "@/activation/types";

declare global {
  namespace Cloudflare {
    interface Env extends ActivationBindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
