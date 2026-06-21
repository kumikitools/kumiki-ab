import { defineConfig } from "vitest/config";

// The MCP server is a plain Node process (stdio transport), not a Worker — so
// unlike @kumikitools/api it runs the default Node test environment. We unit-
// test the two layers C1–C8 inherit: arg validation (composed from the shared
// schema) and error mapping (API envelope → tool error). No network or D1.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
