import { Hono } from "hono";
import type { AppBindings } from "../env";
import { ApiError } from "../errors";
import { getSite, getTestsWithVariantsForSite } from "../db";
import { serializeConfig } from "../serialize";
import {
  cacheMatch,
  cachePut,
  configCacheKey,
  snippetCacheKey,
  DELIVERY_CACHE_CONTROL,
} from "../cache";
import { SNIPPET_JS } from "../snippet-asset";

/**
 * The delivery surface (ARCH §3a) — the public, edge-cached read hot path the
 * snippet hits on every pageview. Two resources, both flattening site → tests →
 * variants into the exact `KumikiConfig` contract:
 *
 *   GET /v1/config/:siteId   → KumikiConfig JSON (the data-config-url fetch path)
 *   GET /s.js?site=:siteId   → the snippet JS with that config baked in (the
 *                              in-<head> one-liner; synchronous → zero flicker)
 *
 * No auth (config is public). Every 200 is cached via the Cache API and tagged
 * `x-kumiki-cache: hit|miss`; writes purge the entry (see cache.ts). Unknown
 * sites / missing params return the standard error envelope and are NOT cached.
 */
export const delivery = new Hono<AppBindings>();

/** Build the site's `KumikiConfig`, or throw 404 if the site doesn't exist. */
async function loadConfig(db: D1Database, siteId: string) {
  const site = await getSite(db, siteId);
  if (!site) {
    throw new ApiError(404, "site_not_found", `No site with id '${siteId}'`);
  }
  const rows = await getTestsWithVariantsForSite(db, siteId);
  return serializeConfig(rows);
}

/** Re-tag a (possibly cached) response with the hit/miss marker on the way out. */
function tagged(res: Response, state: "hit" | "miss"): Response {
  const out = new Response(res.body, res);
  out.headers.set("x-kumiki-cache", state);
  return out;
}

delivery.get("/v1/config/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  const key = configCacheKey(siteId);

  const cached = await cacheMatch(key);
  if (cached) return tagged(cached, "hit");

  const config = await loadConfig(c.env.DB, siteId);
  const res = new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": DELIVERY_CACHE_CONTROL,
    },
  });
  await cachePut(key, res);
  return tagged(res, "miss");
});

delivery.get("/s.js", async (c) => {
  const siteId = c.req.query("site");
  if (!siteId) {
    throw new ApiError(
      400,
      "missing_site",
      "Provide the site id as the 's' query param: /s.js?site=<siteId>",
    );
  }
  const key = snippetCacheKey(siteId);

  const cached = await cacheMatch(key);
  if (cached) return tagged(cached, "hit");

  const config = await loadConfig(c.env.DB, siteId);
  // Inline the config before the snippet IIFE. The snippet reads
  // window.KUMIKI_CONFIG synchronously (no second fetch) → variants apply before
  // first paint. JSON.stringify is a safe JS literal in an application/javascript
  // response (no inline-HTML escaping concerns).
  const body = `window.KUMIKI_CONFIG=${JSON.stringify(config)};\n${SNIPPET_JS}`;
  const res = new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": DELIVERY_CACHE_CONTROL,
    },
  });
  await cachePut(key, res);
  return tagged(res, "miss");
});
