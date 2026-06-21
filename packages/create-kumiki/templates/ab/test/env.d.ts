import type { Env } from "../src/env";

// Type the bindings the test pool exposes via `cloudflare:test`. TEST_MIGRATIONS
// is injected by vitest.config.ts (readD1Migrations) and applied in
// apply-migrations.ts.
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
