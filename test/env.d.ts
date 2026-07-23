/// <reference types="@cloudflare/vitest-pool-workers" />

// Types the test-only `cloudflare:test` module's `env` against our bindings,
// plus the injected migrations array used by the setup hook.
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Bindings } from "@/types/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}
