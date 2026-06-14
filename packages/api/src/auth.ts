import { createMiddleware } from "hono/factory";
import type { AppBindings } from "./env";
import { ApiError } from "./errors";
import { getSite } from "./db";
import { sha256Hex, timingSafeEqualHex } from "./crypto";

/**
 * Write-key auth for control routes (ARCHITECTURE.md §7). The reference pattern
 * for every authenticated route: mount under a path with `:id` for the site,
 * apply `siteAuth()`, then read the verified site via `c.get("site")`.
 *
 * The key is taken from `Authorization: Bearer <key>` (also accepts the bare
 * header value). Delivery + ingestion routes are public and never use this.
 */
export function siteAuth() {
  return createMiddleware<AppBindings>(async (c, next) => {
    const siteId = c.req.param("id");
    if (!siteId) {
      // Programming error: siteAuth mounted on a route without an :id param.
      throw new ApiError(500, "internal_error", "Internal server error");
    }

    const site = await getSite(c.env.DB, siteId);
    if (!site) {
      throw new ApiError(404, "site_not_found", `No site with id '${siteId}'`);
    }

    const provided = extractKey(c.req.header("authorization"));
    if (!provided) {
      throw new ApiError(
        401,
        "missing_key",
        "Provide the site write key as 'Authorization: Bearer <key>'",
      );
    }

    const providedHash = await sha256Hex(provided);
    if (!timingSafeEqualHex(providedHash, site.api_key_hash)) {
      throw new ApiError(403, "invalid_key", "Write key is not valid for this site");
    }

    c.set("site", site);
    await next();
  });
}

/** Pull the key out of an Authorization header, tolerating a missing "Bearer ". */
function extractKey(header: string | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed || null;
}
