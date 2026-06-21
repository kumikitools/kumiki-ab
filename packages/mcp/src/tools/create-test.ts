import { z } from "zod";
import {
  TestStatusSchema,
  UrlTargetingSchema,
  VariantSchema,
} from "@kumikitools/schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * THE REFERENCE MCP TOOL (C0). Every other tool (C1–C8) is a replica of exactly
 * this shape — one tool per control route (ARCH §5: the control surface IS the
 * MCP surface). The four moving parts a replica swaps out:
 *   1. an arg shape that COMPOSES `@kumikitools/schema` primitives (never
 *      re-declares a contract type — the single source of truth, ARCH §0)
 *   2. the route + method it wraps, via the shared `ApiClient`
 *   3. the body it sends (the args minus any path params like `siteId`)
 *   4. nothing else — success/error mapping is shared (`toToolResult`/`toToolError`)
 *
 * Wraps `POST /v1/sites/:id/tests` (the A2 reference control route).
 */

/**
 * Arg shape for `kumiki_create_test`, as a Zod *raw shape* (the form the MCP SDK
 * turns into the tool's JSON Schema). It mirrors the API's
 * `CreateTestRequestSchema`: the contract pieces (`status`, `urlMatch`,
 * `variants`) are the shared schema's primitives; the control-plane pieces
 * (`name`, `conversionWindowDays`) and the MCP-only path arg (`siteId`) are added
 * here. Server-side defaults (status→running, window→7) are intentionally NOT
 * duplicated: omit them and the API applies its own, so policy lives in one place.
 */
export const createTestArgs = {
  siteId: z
    .string()
    .min(1)
    .describe("Public site id (`site_…`) the test is created under."),
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional explicit test id; the server generates a `tst_…` when omitted."),
  name: z.string().min(1).describe("Human-readable test name."),
  status: TestStatusSchema.optional().describe(
    "running | applied | stopped. Defaults to running.",
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
    .describe("W for the user-based conversion window (days). Defaults to 7."),
  urlMatch: UrlTargetingSchema.optional().describe(
    "Optional page targeting; omit to run on every page.",
  ),
  variants: z
    .array(VariantSchema)
    .min(1)
    .describe("Variants (control is just another variant). Ids must be unique."),
  winner: z
    .string()
    .optional()
    .describe("Only meaningful with status=applied; must name one of the variants."),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type CreateTestArgs = z.infer<z.ZodObject<typeof createTestArgs>>;

/**
 * Build the handler against a client. Split out from registration so the
 * tool logic (route, body, mapping) is unit-testable without a live SDK server.
 */
export function createTestHandler(client: ApiClient) {
  return async (args: CreateTestArgs): Promise<CallToolResult> => {
    // The path param is consumed here; everything else is the request body. The
    // API does the full semantic validation (unique ids, winner references a
    // real variant) and returns `invalid_body` / `unknown_winner` — we surface
    // its `code` rather than re-implementing those rules (don't re-declare).
    const { siteId, ...body } = args;
    try {
      const resource = await client.post(
        `/v1/sites/${encodeURIComponent(siteId)}/tests`,
        body,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_create_test` on the server. */
export function registerCreateTest(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_create_test",
    {
      title: "Create A/B test",
      description:
        "Create an A/B test (with its variants) under a site. Wraps " +
        "POST /v1/sites/:id/tests. Returns the created test resource, or a tool " +
        "error carrying the API's code (invalid_body, site_not_found, " +
        "invalid_key, missing_key).",
      inputSchema: createTestArgs,
    },
    createTestHandler(client),
  );
}
