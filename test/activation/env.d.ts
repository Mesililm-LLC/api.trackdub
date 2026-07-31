/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Mirrors test/env.d.ts for the activation Worker's bindings. `DB`, `APP_ENV`,
// and `ADMIN_API_TOKEN` are shared property names with the portal's Bindings
// (same types in both — D1Database / string / string) so this merges safely
// with the portal's Cloudflare.Env augmentation in the same tsconfig program.
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
