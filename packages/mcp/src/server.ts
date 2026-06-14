import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KumikiMcpConfig } from "./config.js";
import { ApiClient } from "./api-client.js";
import { registerCreateTest } from "./tools/create-test.js";

/**
 * Assemble the Kumiki A/B MCP server: one `ApiClient` (env-configured), then one
 * `register…` call per tool. Building the server is separate from connecting a
 * transport (index.ts) so tests can construct it without stdio.
 *
 * C1–C8 each add exactly one more `register…(server, client)` line here — the
 * control surface fills out into the MCP surface one route at a time (ARCH §5).
 */
export function createServer(config: KumikiMcpConfig): McpServer {
  const server = new McpServer({
    name: "kumiki-ab",
    version: "0.0.0",
  });

  const client = new ApiClient(config);

  registerCreateTest(server, client); // C0 — the reference tool.
  // C1–C8: registerListTests, registerGetTest, registerEditTest,
  // registerSetVariants, registerApplyWinner, registerStopTest,
  // registerCreateSite, registerGetResults — added as each route is wrapped.

  return server;
}
