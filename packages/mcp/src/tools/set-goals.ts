import { z } from "zod";
import { GoalSchema } from "@kumikitools/schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * `kumiki_set_goals` — mirrors C4 `set-variants` (a PUT replace-whole-set).
 * Wraps `PUT /v1/sites/:id/goals` (TASK-21). Sends `{ goals }` as the body;
 * the API enforces uniqueness and returns `invalid_body` — we surface its
 * `code` rather than re-implementing the rule.
 */

export const setGoalsArgs = {
  siteId: z
    .string()
    .min(1)
    .describe("Public site id (`site_…`) whose conversion goals to replace."),
  goals: z
    .array(GoalSchema)
    .describe(
      "The full replacement goal set (url, click, or form). " +
        "Replaces the existing set wholesale. Ids must be unique.",
    ),
} as const;

export type SetGoalsArgs = z.infer<z.ZodObject<typeof setGoalsArgs>>;

export function setGoalsHandler(client: ApiClient) {
  return async (args: SetGoalsArgs): Promise<CallToolResult> => {
    const { siteId, ...body } = args;
    try {
      const resource = await client.put(
        `/v1/sites/${encodeURIComponent(siteId)}/goals`,
        body,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

export function registerSetGoals(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_set_goals",
    {
      title: "Replace site conversion goals",
      description:
        "Replace the site-level conversion goal set (the authoring save). " +
        "Wraps PUT /v1/sites/:id/goals. Returns { goals: Goal[] } after the " +
        "write, or a tool error carrying the API's code (invalid_body, " +
        "site_not_found, invalid_key, missing_key).",
      inputSchema: setGoalsArgs,
    },
    setGoalsHandler(client),
  );
}
