import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

// Run tests inside workerd (Miniflare) with a real local D1 binding, so the
// integration tests exercise the same runtime + SQL the Worker uses in prod.
// Migrations are read here and applied per test-run in test/apply-migrations.ts.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            // Surfaced to tests as env.TEST_MIGRATIONS for applyD1Migrations().
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
