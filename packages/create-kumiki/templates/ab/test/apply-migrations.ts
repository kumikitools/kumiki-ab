import { applyD1Migrations, env } from "cloudflare:test";

// Apply the real migrations to the per-run local D1 before any test executes, so
// integration tests hit the same schema the deployed Worker does.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
