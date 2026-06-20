/**
 * Edge cache for the public delivery surface (ARCH §3a, §6). Both
 * `GET /v1/config/:siteId` and `GET /s.js?site=:siteId` are served through
 * Cloudflare's Cache API so config reads bypass the Worker request budget
 * (~99.9% hit). Every config write purges the site's two entries
 * (`purgeSiteCache`) so an edit or the kill switch (B6) is reflected at once —
 * the `Cache-Control` max-age is only the fallback ceiling if a purge is missed.
 *
 * Cache keys are synthetic per-site URLs (not the inbound request URL), so the
 * config and snippet entries for a site can always be located and purged
 * together regardless of host, query order, or how the request arrived.
 *
 * Note: the Cache API is per-colo — a purge clears the cache in the data centre
 * that serves it. With config writes being rare and the short max-age fallback,
 * this is the right MVP primitive; zone-wide purge (API token) is a scale-up.
 */
const CACHE_ORIGIN = "https://cache.kumiki.internal";

/** Seconds the CDN/browser may serve a delivery response before revalidating. */
export const DELIVERY_MAX_AGE = 60;

/** `Cache-Control` for both delivery responses. Public + short, purge-backed. */
export const DELIVERY_CACHE_CONTROL = `public, max-age=${DELIVERY_MAX_AGE}`;

export function configCacheKey(siteId: string): string {
  return `${CACHE_ORIGIN}/v1/config/${encodeURIComponent(siteId)}`;
}

export function snippetCacheKey(siteId: string): string {
  return `${CACHE_ORIGIN}/s.js/${encodeURIComponent(siteId)}`;
}

/** Look up a delivery response in the edge cache. */
export function cacheMatch(key: string): Promise<Response | undefined> {
  return caches.default.match(key);
}

/** Store a delivery response. Clones so the caller can still return the body. */
export async function cachePut(key: string, res: Response): Promise<void> {
  await caches.default.put(key, res.clone());
}

/**
 * Purge-on-write: drop both delivery entries for a site. EVERY control route
 * that mutates a site's config (create/edit/variants/apply/stop — B1–B6) MUST
 * call this after a successful write. Idempotent; safe to call on a cold cache.
 */
export async function purgeSiteCache(siteId: string): Promise<void> {
  await Promise.all([
    caches.default.delete(configCacheKey(siteId)),
    caches.default.delete(snippetCacheKey(siteId)),
  ]);
}
