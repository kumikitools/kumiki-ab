import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiClient } from "../api-client.js";
import { toToolError, toToolResult } from "../tool-result.js";

/**
 * `kumiki_create_site` (C7) — a replica of the C0 reference tool
 * (`create-test.ts`), with ONE deliberate wrinkle: the route it wraps is the
 * site bootstrap, the one control route that is NOT bearer-authed.
 *
 * Wraps `POST /v1/sites` (ARCH §3c). Unlike every other tool, this route does
 * NOT act under the configured `KUMIKI_API_KEY`:
 *   - It needs no auth — it is where a write key is MINTED, so it cannot require
 *     one. The shared `ApiClient` still attaches `Authorization: Bearer
 *     <KUMIKI_API_KEY>`, but this route ignores it; the configured key is
 *     irrelevant to the result. (Kept on-pattern: a tool never touches `fetch`
 *     directly — the ignored header is harmless and keeps the tool thin.)
 *   - It returns a freshly-minted `writeKey` (`ksk_…`) EXACTLY ONCE — the API
 *     stores only its hash and can never reveal it again. That returned key is
 *     what you then set as `KUMIKI_API_KEY` to use every other tool. The tool
 *     surfaces the full JSON resource (including `writeKey`); saving it is the
 *     caller's responsibility.
 *
 * Arg shape: just `{ name }`. Sites are not a wire contract in
 * `@kumikitools/schema` (only configs/events/results are), so there is no Site
 * contract type to compose or redeclare — `name` is a control-plane field, added
 * inline exactly as `create-test` adds its own `name`. Mirrors the API's
 * `CreateSiteRequestSchema` (`{ name: z.string().min(1) }`).
 */
export const createSiteArgs = {
  name: z.string().min(1).describe("Human-readable site name."),
} as const;

/** Validated args (what the SDK hands the handler after checking the raw shape). */
export type CreateSiteArgs = z.infer<z.ZodObject<typeof createSiteArgs>>;

/**
 * Build the handler against a client. Split out from registration so the tool
 * logic (route, body, mapping) is unit-testable without a live SDK server.
 */
export function createSiteHandler(client: ApiClient) {
  return async (args: CreateSiteArgs): Promise<CallToolResult> => {
    // No path param to strip: the whole arg object IS the body. The API does the
    // semantic validation and returns `invalid_body`; we surface its `code`.
    try {
      const resource = await client.post("/v1/sites", args);
      return toToolResult(resource);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Register `kumiki_create_site` on the server. */
export function registerCreateSite(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "kumiki_create_site",
    {
      title: "Create site (bootstrap)",
      description:
        "Bootstrap a new site and mint its write key. Wraps POST /v1/sites — " +
        "the one UNAUTHENTICATED control route (the configured KUMIKI_API_KEY is " +
        "ignored here). Returns the created site resource INCLUDING a one-time " +
        "writeKey (ksk_…): save it and set it as KUMIKI_API_KEY to use every " +
        "other tool — it is never recoverable afterwards. On failure returns a " +
        "tool error carrying the API's code (invalid_body).",
      inputSchema: createSiteArgs,
    },
    createSiteHandler(client),
  );
}
