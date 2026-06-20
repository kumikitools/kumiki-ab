import { Hono } from "hono";
import type { AppBindings } from "../env";
import { siteAuth } from "../auth";
import { ApiError } from "../errors";
import { getSite, setSiteWebhook } from "../db";
import { SetWebhookRequestSchema, validateJson } from "../validation";

/**
 * Webhook configuration routes (D4, ARCHITECTURE.md §4 "Outbound integrations").
 * Mounted under `/v1/sites` alongside the test control routes. All three endpoints
 * are site-scoped and gated by `siteAuth()`.
 *
 *   GET    /v1/sites/:id/webhook  — read config (never returns the secret)
 *   PUT    /v1/sites/:id/webhook  — set / update config; generates + returns the
 *                                   secret exactly once when omitted on first set
 *   DELETE /v1/sites/:id/webhook  — disable delivery (does not clear the config)
 *
 * The secret is stored plaintext (HMAC-SHA256 needs the raw value, unlike the
 * write key which is stored hashed). Acceptable on the operator's own self-hosted
 * D1 (§7: single-operator, no multi-user at Phase 1).
 *
 * No cache purge: webhook delivery config is NOT part of the served KumikiConfig
 * (it's server-side only), so `purgeSiteCache` is not called here.
 */
export const webhookRoutes = new Hono<AppBindings>();

/** Mint a random HMAC signing secret: 32 random bytes as lowercase hex. */
function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** GET /v1/sites/:id/webhook — return config WITHOUT the secret. */
webhookRoutes.get("/:id/webhook", siteAuth(), (c) => {
  const site = c.get("site");
  if (!site.webhook_url) {
    throw new ApiError(404, "webhook_not_found", "No webhook configured for this site");
  }
  return c.json({
    url: site.webhook_url,
    events: site.webhook_events,
    enabled: site.webhook_enabled === 1,
  });
});

/**
 * PUT /v1/sites/:id/webhook — set or update webhook config.
 *
 * Secret handling:
 *   - If the caller provides `secret`: use it as-is (they manage the secret).
 *   - Else if the site already has a secret: keep it (no change, not returned).
 *   - Else (first set, no existing secret): generate one and return it ONCE in
 *     this response. It is never returned again via GET or subsequent PUTs.
 */
webhookRoutes.put("/:id/webhook", siteAuth(), async (c) => {
  const site = c.get("site");
  const body = await validateJson(c, SetWebhookRequestSchema);

  let secretToStore: string;
  let generatedSecret: string | undefined;

  if (body.secret !== undefined) {
    secretToStore = body.secret;
  } else if (site.webhook_secret !== null) {
    secretToStore = site.webhook_secret;
  } else {
    generatedSecret = generateWebhookSecret();
    secretToStore = generatedSecret;
  }

  const events = body.events ?? site.webhook_events ?? "all";
  const enabled = body.enabled !== undefined
    ? (body.enabled ? 1 : 0)
    : (site.webhook_url === null ? 1 : site.webhook_enabled);

  await setSiteWebhook(c.env.DB, site.id, {
    url: body.url,
    secret: secretToStore,
    events,
    enabled,
  });

  const updated = await getSite(c.env.DB, site.id);
  if (!updated) {
    throw new ApiError(500, "internal_error", "Internal server error");
  }

  const response: Record<string, unknown> = {
    url: updated.webhook_url,
    events: updated.webhook_events,
    enabled: updated.webhook_enabled === 1,
  };
  if (generatedSecret !== undefined) {
    response.secret = generatedSecret;
  }
  return c.json(response);
});

/** DELETE /v1/sites/:id/webhook — disable delivery (keeps config for re-enable). */
webhookRoutes.delete("/:id/webhook", siteAuth(), async (c) => {
  const site = c.get("site");
  if (!site.webhook_url) {
    throw new ApiError(404, "webhook_not_found", "No webhook configured for this site");
  }

  await setSiteWebhook(c.env.DB, site.id, {
    url: site.webhook_url,
    secret: site.webhook_secret ?? "",
    events: site.webhook_events,
    enabled: 0,
  });

  return c.json({ enabled: false });
});
