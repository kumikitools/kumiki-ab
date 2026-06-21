import { z } from "zod";
import { VariantSchema } from "@kumikitools/schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C4 — `kumiki_set_variants`. A replica of the reference tool (C0,
 * `create-test.ts`): same four moving parts swapped, success/error mapping
 * shared. Wraps `PUT /v1/tests/:id/variants` (B4) — replace the whole variant
 * set (the editor "save" of a test's variants).
 *
 * Wraps `PUT /v1/tests/:id/variants`.
 */

/**
 * Arg shape for `kumiki_set_variants`, as a Zod *raw shape*. It mirrors the
 * API's `ReplaceVariantsRequestSchema`: the variant set is the shared schema's
 * `VariantSchema` primitive (so `changes[]` is validated by the single source
 * of truth), and the MCP-only path arg (`testId`) is added here. The test-level
 * "ids must be unique" invariant lives in the API (it returns `invalid_body`);
 * we don't re-declare it — policy stays in one place.
 */
export const setVariantsArgs = {
  testId: z
    .string()
    .min(1)
    .describe("Test id (`tst_…`) whose variant set to replace."),
  variants: z
    .array(VariantSchema)
    .min(1)
    .describe(
      "The full replacement variant set (control is just another variant). " +
        "Replaces the existing set wholesale. Ids must be unique.",
    ),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type SetVariantsArgs = z.infer<z.ZodObject<typeof setVariantsArgs>>;

/**
 * Build the handler against a client. Split out from registration so the tool
 * logic (route, body, mapping) is unit-testable without a live SDK server.
 */
export function setVariantsHandler(client: ApiClient) {
  return async (args: SetVariantsArgs): Promise<CallToolResult> => {
    // The path param is consumed here; everything else is the request body. The
    // API enforces the semantic rules (ids unique, non-empty) and returns
    // `invalid_body` — we surface its `code` rather than re-implementing the
    // rule (don't re-declare).
    const { testId, ...body } = args;
    try {
      const resource = await client.put(
        `/v1/tests/${encodeURIComponent(testId)}/variants`,
        body,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_set_variants` on the server. */
export function registerSetVariants(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_set_variants",
    {
      title: "Replace A/B test variants",
      description:
        "Replace the whole variant set of an A/B test (the editor save). " +
        "Wraps PUT /v1/tests/:id/variants. Returns the updated test resource, " +
        "or a tool error carrying the API's code (invalid_body, " +
        "test_not_found, invalid_key, missing_key).",
      inputSchema: setVariantsArgs,
    },
    setVariantsHandler(client),
  );
}
