import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C6 `kumiki_stop_test` — a replica of the reference tool (C0,
 * `create-test.ts`). It wraps `POST /v1/tests/:id/stop` (ARCH §3c B6): the
 * instant kill switch (status → stopped, delivery cache purged). The four moving
 * parts a replica swaps:
 *   1. the arg shape — just `testId` (the path param); the route takes no body
 *   2. the route + method — `POST /v1/tests/:id/stop` via `client.post`
 *   3. the body — none (so we send `undefined`, not an empty object)
 *   4. nothing else — success/error mapping is shared.
 *
 * There is no semantic rule for the tool to own: stopping is unconditional. The
 * API returns `404 test_not_found` / `invalid_key` / `missing_key`; we surface
 * its `code` rather than second-guessing it (single source of truth, ARCH §0).
 */

/**
 * Arg shape for `kumiki_stop_test`, as a Zod *raw shape*. Only the MCP-only path
 * arg `testId` — a `tst_…` id reference, the same `z.string().min(1)` form C0
 * uses for `siteId`. There is no contract type to compose or re-declare here:
 * the body is empty, and the result is the shared `Test` resource the API reads
 * back (not re-declared by the tool).
 */
export const stopTestArgs = {
  testId: z
    .string()
    .min(1)
    .describe("Test id (`tst_…`) to stop (status → stopped)."),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type StopTestArgs = z.infer<z.ZodObject<typeof stopTestArgs>>;

/**
 * Build the handler against a client. Split from registration so the tool logic
 * (route, body, mapping) is unit-testable without a live SDK server.
 */
export function stopTestHandler(client: ApiClient) {
  return async (args: StopTestArgs): Promise<CallToolResult> => {
    // The path param is the whole arg; the stop route takes no body.
    const { testId } = args;
    try {
      const resource = await client.post(
        `/v1/tests/${encodeURIComponent(testId)}/stop`,
        undefined,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_stop_test` on the server. */
export function registerStopTest(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_stop_test",
    {
      title: "Stop A/B test",
      description:
        "Stop an A/B test — the instant kill switch (status → stopped). Wraps " +
        "POST /v1/tests/:id/stop. Returns the updated test resource, or a tool " +
        "error carrying the API's code (test_not_found, invalid_key, " +
        "missing_key).",
      inputSchema: stopTestArgs,
    },
    stopTestHandler(client),
  );
}
