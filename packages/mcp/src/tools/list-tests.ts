import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C1 — a replica of the reference tool (`create-test.ts`, C0). The four moving
 * parts a replica swaps out (ARCH §5: one tool per control route):
 *   1. an arg shape that COMPOSES `@kumikitools/schema` primitives — here the
 *      only arg is the MCP-only path param `siteId`, so there is no contract
 *      type to compose (and so, per ARCH §0, none is re-declared).
 *   2. the route + method: `GET /v1/sites/:id/tests`, via `client.get`.
 *   3. the body: none — a list is a pure read, the siteId is the whole input.
 *   4. nothing else — success/error mapping is shared.
 *
 * Wraps `GET /v1/sites/:id/tests` (the B1 list control route).
 */

/**
 * Arg shape for `kumiki_list_tests`, as a Zod *raw shape* (the form the MCP SDK
 * turns into the tool's JSON Schema). `siteId` is the MCP-only path arg (it maps
 * to the route's `:id`); there are no body fields, since listing is a read.
 */
export const listTestsArgs = {
  siteId: z
    .string()
    .min(1)
    .describe("Public site id (`site_…`) whose tests to list."),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type ListTestsArgs = z.infer<z.ZodObject<typeof listTestsArgs>>;

/**
 * Build the handler against a client. Split out from registration so the
 * tool logic (route, mapping) is unit-testable without a live SDK server.
 */
export function listTestsHandler(client: ApiClient) {
  return async (args: ListTestsArgs): Promise<CallToolResult> => {
    // The path param is the whole input; a GET carries no body. The API applies
    // the same `siteAuth()` gate as create and returns `site_not_found` /
    // `invalid_key` / `missing_key`, whose `code` we surface rather than swallow.
    const { siteId } = args;
    try {
      const resource = await client.get(
        `/v1/sites/${encodeURIComponent(siteId)}/tests`,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_list_tests` on the server. */
export function registerListTests(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_list_tests",
    {
      title: "List A/B tests",
      description:
        "List every A/B test under a site (each as the full test resource). " +
        "Wraps GET /v1/sites/:id/tests. Returns the array of test resources, or " +
        "a tool error carrying the API's code (site_not_found, invalid_key, " +
        "missing_key).",
      inputSchema: listTestsArgs,
    },
    listTestsHandler(client),
  );
}
