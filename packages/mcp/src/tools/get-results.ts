import { z } from "zod";
import type { Results } from "@kumikitools/schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C8 — `kumiki_get_results`. A replica of the C0 reference tool (create-test.ts),
 * the READ that closes the agent-native loop (create → serve → collect → READ).
 *
 * Wraps `GET /v1/tests/:id/results` (the D2 results route). The four moving parts
 * a replica swaps out:
 *   1. arg shape — just the `testId` path param (no body, no composed primitives;
 *      the result is the `Results` contract, owned by `@kumikitools/schema`).
 *   2. route + method — `client.get` on the test's results route.
 *   3. body — none (GET; the path param is the only input).
 *   4. nothing else — success/error mapping is shared.
 *
 * The posterior math (user-based, windowed beta-binomial — ARCH §4) lives
 * server-side (api/src/stats.ts); the tool just wraps the route and returns the
 * `Results` JSON unchanged.
 */

/**
 * Arg shape for `kumiki_get_results`, as a Zod *raw shape*. `testId` is the only
 * input — the path param the route reads. The response shape is the shared
 * `ResultsSchema` (type `Results`), never re-declared here.
 */
export const getResultsArgs = {
  testId: z
    .string()
    .min(1)
    .describe("Test id (`tst_…`) to read the windowed results summary for."),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type GetResultsArgs = z.infer<z.ZodObject<typeof getResultsArgs>>;

/**
 * Build the handler against a client. Split out from registration so the tool
 * logic (route, mapping) is unit-testable without a live SDK server.
 */
export function getResultsHandler(client: ApiClient) {
  return async (args: GetResultsArgs): Promise<CallToolResult> => {
    const { testId } = args;
    try {
      // GET → no body; the testId is the only input, in the path. The API
      // computes the posterior summary and returns the `Results` contract; we
      // pass it through. API errors (test_not_found, invalid_key) surface via
      // toToolError with their `code` preserved.
      const results = (await client.get(
        `/v1/tests/${encodeURIComponent(testId)}/results`,
      )) as Results;
      return toToolResult(results);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_get_results` on the server. */
export function registerGetResults(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_get_results",
    {
      title: "Get A/B test results",
      description:
        "Read a test's user-based, windowed beta-binomial results summary " +
        "(per-variant exposed/converted/rate/pBest/ci95, and the posterior " +
        "winner if any). Wraps GET /v1/tests/:id/results. Returns the Results " +
        "resource, or a tool error carrying the API's code (test_not_found, " +
        "invalid_key, missing_key).",
      inputSchema: getResultsArgs,
    },
    getResultsHandler(client),
  );
}
