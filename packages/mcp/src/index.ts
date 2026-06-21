#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

/**
 * Entry point (the `kumiki-mcp` bin). Read the env auth (KUMIKI_API_URL/KEY),
 * build the server, and serve it over stdio — the transport Claude Code spawns
 * it with. Fail fast with a clear message if the env is missing.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe to log to (stdout is the JSON-RPC channel).
  console.error(`kumiki-ab MCP server ready → ${config.apiUrl}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
