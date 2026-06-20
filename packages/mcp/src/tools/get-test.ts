import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C2 — a replica of the reference tool (`create-test.ts`, C0). The four moving
 * parts a replica swaps out (ARCH §5: one tool per control route):
 *   1. an arg shape that COMPOSES `@kumikitools/schema` primitives — here the
 *      only arg is the MCP-only path param `testId`, so there is no contract
 *      type to compose (and so, per ARCH §0, none is re-declared).
 *   2. the route + method: `GET /v1/tests/:id`, via `client.get`.
 *   3. the body: none — a get is a pure read, the testId is the whole input.
 *   4. nothing else — success/error mapping is shared.
 *
 * Wraps `GET /v1/tests/:id` (the B2 test-get control route). Note `:id` here is a
 * **testId** (these routes are mounted under `/v1/tests` and gated by `testAuth`),
 * unlike the site-scoped `:id` of C0/C1.
 */

/**
 * Arg shape for `kumiki_get_test`, as a Zod *raw shape* (the form the MCP SDK
 * turns into the tool's JSON Schema). `testId` is the MCP-only path arg (it maps
 * to the route's `:id`); there are no body fields, since getting is a read.
 */
export const getTestArgs = {
  testId: z
    .string()
    .min(1)
    .describe("Public test id (`tst_…`) to fetch."),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type GetTestArgs = z.infer<z.ZodObject<typeof getTestArgs>>;

/**
 * Build the handler against a client. Split out from registration so the
 * tool logic (route, mapping) is unit-testable without a live SDK server.
 */
export function getTestHandler(client: ApiClient) {
  return async (args: GetTestArgs): Promise<CallToolResult> => {
    // The path param is the whole input; a GET carries no body. The API applies
    // the `testAuth()` gate and returns `test_not_found` / `invalid_key` /
    // `missing_key`, whose `code` we surface rather than swallow.
    const { testId } = args;
    try {
      const resource = await client.get(
        `/v1/tests/${encodeURIComponent(testId)}`,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_get_test` on the server. */
export function registerGetTest(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_get_test",
    {
      title: "Get A/B test",
      description:
        "Fetch a single A/B test (with its variants) by id. Wraps GET " +
        "/v1/tests/:id. Returns the full test resource, or a tool error " +
        "carrying the API's code (test_not_found, invalid_key, missing_key).",
      inputSchema: getTestArgs,
    },
    getTestHandler(client),
  );
}
