import { z } from "zod";
import { TestStatusSchema, UrlTargetingSchema } from "@kumikitools/schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C3 — `kumiki_edit_test`. A replica of the reference tool (C0,
 * `create-test.ts`): same four moving parts swapped, success/error mapping
 * shared. Wraps `PATCH /v1/tests/:id` (B3), a partial edit of the control-plane
 * test — status / coverage / window / name / targeting.
 *
 * Wraps `PATCH /v1/tests/:id`.
 */

/**
 * Arg shape for `kumiki_edit_test`, as a Zod *raw shape*. It mirrors the API's
 * `PatchTestRequestSchema`: every editable field is the shared schema's
 * primitive (`status`, `urlMatch`) or a plain control-plane scalar, and every
 * one is optional. The MCP-only path arg (`testId`) is added here. The "at least
 * one field to update" rule lives in the API (it returns `invalid_body`); we
 * don't re-declare it — policy stays in one place. `winner` is intentionally
 * absent: it's set by the deliberate apply route (C5), not a general edit.
 */
export const editTestArgs = {
  testId: z
    .string()
    .min(1)
    .describe("Test id (`tst_…`) to edit."),
  name: z.string().min(1).optional().describe("New human-readable test name."),
  status: TestStatusSchema.optional().describe(
    "running | applied | stopped.",
  ),
  coverage: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Fraction [0,1] of visitors entered into the experiment."),
  conversionWindowDays: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("W for the user-based conversion window (days)."),
  urlMatch: UrlTargetingSchema.optional().describe(
    "Page targeting to apply to the test.",
  ),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type EditTestArgs = z.infer<z.ZodObject<typeof editTestArgs>>;

/**
 * Build the handler against a client. Split out from registration so the tool
 * logic (route, body, mapping) is unit-testable without a live SDK server.
 */
export function editTestHandler(client: ApiClient) {
  return async (args: EditTestArgs): Promise<CallToolResult> => {
    // The path param is consumed here; everything else is the request body. The
    // API enforces "provide at least one field" and returns `invalid_body` — we
    // surface its `code` rather than re-implementing the rule (don't re-declare).
    const { testId, ...body } = args;
    try {
      const resource = await client.patch(
        `/v1/tests/${encodeURIComponent(testId)}`,
        body,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_edit_test` on the server. */
export function registerEditTest(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_edit_test",
    {
      title: "Edit A/B test",
      description:
        "Partially edit an A/B test (name, status, coverage, conversion " +
        "window, or URL targeting). Wraps PATCH /v1/tests/:id. Returns the " +
        "updated test resource, or a tool error carrying the API's code " +
        "(invalid_body, test_not_found, invalid_key, missing_key).",
      inputSchema: editTestArgs,
    },
    editTestHandler(client),
  );
}
