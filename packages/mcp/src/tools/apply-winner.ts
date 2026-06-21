import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C5 `kumiki_apply_winner` — a replica of the reference tool (C0,
 * `create-test.ts`). It wraps `POST /v1/tests/:id/apply` (ARCH §3c B5): roll one
 * variant to 100% (status → applied). The four moving parts a replica swaps:
 *   1. the arg shape — `testId` (path param) + `winner` (the body)
 *   2. the route + method — `POST /v1/tests/:id/apply` via `client.post`
 *   3. the body — `{ winner }` (the args minus the `testId` path param)
 *   4. nothing else — success/error mapping is shared.
 *
 * The API owns the semantic rule: `winner` must name a real variant of this
 * test. That's a DB check, so the route returns `400 unknown_winner` (and
 * `400 invalid_body` / `404 test_not_found` / `invalid_key`); we surface its
 * `code` rather than re-validating here (single source of truth, ARCH §0).
 */

/**
 * Arg shape for `kumiki_apply_winner`, as a Zod *raw shape*. `winner` mirrors the
 * API's `ApplyTestRequestSchema` field (`z.string().min(1)` — a variant-id ref,
 * not a contract type to re-declare); `testId` is the MCP-only path arg.
 */
export const applyWinnerArgs = {
  testId: z
    .string()
    .min(1)
    .describe("Test id (`tst_…`) whose winner is being applied."),
  winner: z
    .string()
    .min(1)
    .describe(
      "Id of the variant to roll to 100%. Must name a real variant of the " +
        "test; the API returns `unknown_winner` otherwise.",
    ),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type ApplyWinnerArgs = z.infer<z.ZodObject<typeof applyWinnerArgs>>;

/**
 * Build the handler against a client. Split from registration so the tool logic
 * (route, body, mapping) is unit-testable without a live SDK server.
 */
export function applyWinnerHandler(client: ApiClient) {
  return async (args: ApplyWinnerArgs): Promise<CallToolResult> => {
    // The path param is consumed here; the rest is the request body.
    const { testId, ...body } = args;
    try {
      const resource = await client.post(
        `/v1/tests/${encodeURIComponent(testId)}/apply`,
        body,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_apply_winner` on the server. */
export function registerApplyWinner(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_apply_winner",
    {
      title: "Apply A/B test winner",
      description:
        "Roll one variant of a test to 100% (status → applied). Wraps " +
        "POST /v1/tests/:id/apply. Returns the updated test resource, or a tool " +
        "error carrying the API's code (unknown_winner, invalid_body, " +
        "test_not_found, invalid_key, missing_key).",
      inputSchema: applyWinnerArgs,
    },
    applyWinnerHandler(client),
  );
}
