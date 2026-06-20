import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * C9 — `kumiki_set_webhook`. Wraps `PUT /v1/sites/:id/webhook` (D4).
 *
 * Mirrors the C0 reference shape: one arg shape that composes the API contract,
 * one handler that strips the path param and sends the rest as body, one
 * registration. Success / error mapping is shared (`toToolResult` / `toToolError`).
 *
 * The secret is returned exactly once (when the server generates it on first set).
 * On subsequent calls without providing a `secret`, the existing stored secret is
 * kept and not returned — the agent must save it from the first response.
 */

export const setWebhookArgs = {
  siteId: z
    .string()
    .min(1)
    .describe("Site id (`site_…`) to configure the outbound webhook for."),
  url: z
    .string()
    .min(1)
    .describe(
      "HTTPS destination URL. Must be https:// and must not point to localhost, " +
        "RFC1918, or link-local addresses.",
    ),
  secret: z
    .string()
    .min(16)
    .optional()
    .describe(
      "HMAC-SHA256 signing secret (≥16 chars). Omit on first set to have the " +
        "server generate one — it is returned once and never again.",
    ),
  events: z
    .enum(["all", "conversions"])
    .optional()
    .describe(
      "Delivery scope: 'all' forwards exposures + conversions (default); " +
        "'conversions' forwards only conversion events.",
    ),
  enabled: z
    .boolean()
    .optional()
    .describe("Enable or disable delivery. Defaults to true on first set."),
} as const;

export type SetWebhookArgs = z.infer<z.ZodObject<typeof setWebhookArgs>>;

export function setWebhookHandler(client: ApiClient) {
  return async (args: SetWebhookArgs): Promise<CallToolResult> => {
    const { siteId, ...body } = args;
    try {
      const resource = await client.put(
        `/v1/sites/${encodeURIComponent(siteId)}/webhook`,
        body,
      );
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

export function registerSetWebhook(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_set_webhook",
    {
      title: "Configure site webhook",
      description:
        "Set or update the outbound webhook for a site. Wraps PUT /v1/sites/:id/webhook. " +
        "On first set without a secret, the server generates one and returns it once — save it. " +
        "GET /v1/sites/:id/webhook never returns the secret. Returns the webhook config, or a " +
        "tool error carrying the API's code (invalid_body, site_not_found, invalid_key, missing_key).",
      inputSchema: setWebhookArgs,
    },
    setWebhookHandler(client),
  );
}
