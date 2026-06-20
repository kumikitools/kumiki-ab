import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * `kumiki_get_goals` — mirrors C1 `list-tests` (a pure GET, siteId in path).
 * Wraps `GET /v1/sites/:id/goals` (TASK-21). Returns `{ goals: Goal[] }`, or
 * a tool error carrying the API's `code` (site_not_found, invalid_key, …).
 */

export const getGoalsArgs = {
  siteId: z
    .string()
    .min(1)
    .describe("Public site id (`site_…`) whose conversion goals to retrieve."),
} as const;

export type GetGoalsArgs = z.infer<z.ZodObject<typeof getGoalsArgs>>;

export function getGoalsHandler(client: ApiClient) {
  return async (args: GetGoalsArgs): Promise<CallToolResult> => {
    const { siteId } = args;
    try {
      const resource = await client.get(
        `/v1/sites/${encodeURIComponent(siteId)}/goals`,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

export function registerGetGoals(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_get_goals",
    {
      title: "Get site conversion goals",
      description:
        "Retrieve the site-level conversion goal set. " +
        "Wraps GET /v1/sites/:id/goals. Returns { goals: Goal[] }, or " +
        "a tool error carrying the API's code (site_not_found, invalid_key, " +
        "missing_key).",
      inputSchema: getGoalsArgs,
    },
    getGoalsHandler(client),
  );
}
