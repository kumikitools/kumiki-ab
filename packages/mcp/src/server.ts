import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KumikiMcpConfig } from "./config.js";
import { ApiClient } from "./api-client.js";
import { registerCreateTest } from "./tools/create-test.js";
import { registerListTests } from "./tools/list-tests.js";
import { registerGetTest } from "./tools/get-test.js";
import { registerEditTest } from "./tools/edit-test.js";
import { registerSetVariants } from "./tools/set-variants.js";
import { registerApplyWinner } from "./tools/apply-winner.js";
import { registerStopTest } from "./tools/stop-test.js";
import { registerCreateSite } from "./tools/create-site.js";
import { registerGetResults } from "./tools/get-results.js";
import { registerSetWebhook } from "./tools/set-webhook.js";

/**
 * Assemble the Kumiki A/B MCP server: one `ApiClient` (env-configured), then one
 * `register…` call per tool. Building the server is separate from connecting a
 * transport (index.ts) so tests can construct it without stdio.
 *
 * The control surface IS the MCP surface (ARCH §5): every control route has a
 * tool. C0 is the reference; C1–C8 each wrap one more route.
 */
export function createServer(config: KumikiMcpConfig): McpServer {
  const server = new McpServer({
    name: "kumiki-ab",
    version: "0.0.0",
  });

  const client = new ApiClient(config);

  registerCreateTest(server, client); // C0 — POST /v1/sites/:id/tests (reference).
  registerListTests(server, client); // C1 — GET /v1/sites/:id/tests.
  registerGetTest(server, client); // C2 — GET /v1/tests/:id.
  registerEditTest(server, client); // C3 — PATCH /v1/tests/:id.
  registerSetVariants(server, client); // C4 — PUT /v1/tests/:id/variants.
  registerApplyWinner(server, client); // C5 — POST /v1/tests/:id/apply.
  registerStopTest(server, client); // C6 — POST /v1/tests/:id/stop (kill switch).
  registerCreateSite(server, client); // C7 — POST /v1/sites (unauthed bootstrap).
  registerGetResults(server, client); // C8 — GET /v1/tests/:id/results (READ).
  registerSetWebhook(server, client); // C9 — PUT /v1/sites/:id/webhook (D4).

  return server;
}
