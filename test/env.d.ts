/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `cloudflare:test`'s `env` is typed as `Cloudflare.Env` (the same global the
// generated `wrangler types` output augments). Declare it here so tests don't
// depend on a `wrangler types` run, and add the injected migrations array used
// by the setup hook.
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Bindings } from "@/types/env";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
