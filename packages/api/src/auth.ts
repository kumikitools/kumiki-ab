import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppBindings, SiteRow } from "./env";
import { ApiError } from "./errors";
import { getSite, getTest } from "./db";
import { sha256Hex, timingSafeEqualHex } from "./crypto";

/**
 * Write-key auth for control routes (ARCHITECTURE.md §7). The reference pattern
 * for site-scoped routes: mount under a path with `:id` for the site, apply
 * `siteAuth()`, then read the verified site via `c.get("site")`.
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

    await verifyWriteKey(c, site);
    c.set("site", site);
    await next();
  });
}

/**
 * Write-key auth for **test-scoped** routes (B2–B6, where `:id` is a testId, not
 * a siteId). Loads the test, resolves its owning site, and verifies the key
 * against that site — so a key only ever reaches the tests of its own site.
 * Sets both `c.get("test")` and `c.get("site")` (already loaded, free to reuse).
 *
 * 404s an unknown test *before* the key check, mirroring `siteAuth`'s 404-then-
 * auth order (testIds are unguessable `tst_<uuid>`, so this leaks nothing).
 */
export function testAuth() {
  return createMiddleware<AppBindings>(async (c, next) => {
    const testId = c.req.param("id");
    if (!testId) {
      // Programming error: testAuth mounted on a route without an :id param.
      throw new ApiError(500, "internal_error", "Internal server error");
    }

    const test = await getTest(c.env.DB, testId);
    if (!test) {
      throw new ApiError(404, "test_not_found", `No test with id '${testId}'`);
    }

    const site = await getSite(c.env.DB, test.site_id);
    if (!site) {
      // A test without its site is a data-integrity bug, not a client error.
      throw new ApiError(500, "internal_error", "Internal server error");
    }

    await verifyWriteKey(c, site);
    c.set("site", site);
    c.set("test", test);
    await next();
  });
}

/**
 * Shared key check for both middlewares: pull the bearer key, hash it, and
 * timing-safe compare against the site's stored hash. Throws the standard 401/
 * 403 envelopes; returns nothing on success.
 */
async function verifyWriteKey(
  c: Context<AppBindings>,
  site: SiteRow,
): Promise<void> {
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
}

/** Pull the key out of an Authorization header, tolerating a missing "Bearer ". */
function extractKey(header: string | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed || null;
}
