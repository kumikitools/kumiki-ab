import { Hono } from "hono";
import { EventBatchSchema, type KumikiEvent } from "@kumikitools/schema";
import type { AppBindings, ConversionRow, ExposureRow } from "../env";
import { ApiError } from "../errors";
import { getSite, insertEvents, insertWebhookDelivery } from "../db";
import { validateJson } from "../validation";

/**
 * The ingestion surface (ARCHITECTURE.md §3b) — the public, high-volume write hot
 * path. `POST /v1/e/:siteId` receives the snippet's client-batched beacon
 * (exposures + conversions) and appends it to the event store (§2b), which the
 * results route (D2, §4) reads.
 *
 * This is NEW foundation, not a replica of the control surface — it sets the
 * ingestion conventions the rest of the D-series inherits. Three differ from
 * control (which is authenticated and never fails open):
 *
 *   (a) PUBLIC — no `siteAuth` (§7: the beacon is a public write, no PII; the
 *       opaque visitor id is not an identifier).
 *   (b) FAIL-OPEN — any *write/store* failure → drop the events, return 2xx,
 *       never surface an error that could make the snippet retry-storm or that
 *       implies the page should block. The free-tier write ceiling errors HARD
 *       (D1 rejects writes at 100k/day, §6), so the write MUST be allowed to fail
 *       silently. Mirrors the snippet's own fail-open design.
 *   (c) IDEMPOTENCY DEDUP — each event carries a client key; the unique
 *       (site_id, key) constraint + INSERT OR IGNORE (see db.insertEvents) drops
 *       retried beacons so they don't double-count.
 *
 * The ONE non-fail-open case (§3b): an unknown site is rejected (404), not
 * accepted — we never write arbitrary rows for a site that doesn't exist. This is
 * the MVP-simple per-site guard; a real rate-limiter / sampling (§9.8) is a
 * scale-up, deferred. The bounded batch size (schema `MAX_EVENTS_PER_BATCH`) is
 * the per-request half of that guard.
 */
export const ingest = new Hono<AppBindings>();

/** Split a validated beacon batch into typed event-store rows, stamping siteId. */
function toRows(
  siteId: string,
  events: KumikiEvent[],
): { exposures: ExposureRow[]; conversions: ConversionRow[] } {
  const exposures: ExposureRow[] = [];
  const conversions: ConversionRow[] = [];

  for (const e of events) {
    if (e.type === "exposure") {
      exposures.push({
        site_id: siteId,
        idempotency_key: e.key,
        test_id: e.testId,
        variant_id: e.variantId,
        visitor_id: e.visitorId,
        ts: e.ts,
      });
    } else {
      conversions.push({
        site_id: siteId,
        idempotency_key: e.key,
        goal: e.goal,
        visitor_id: e.visitorId,
        ts: e.ts,
        value: e.value ?? null,
      });
    }
  }

  return { exposures, conversions };
}

ingest.post("/:siteId", async (c) => {
  const siteId = c.req.param("siteId");

  // Malformed body is a client error (400) — the snippet builds the batch, so a
  // bad shape is a bug to surface, not page-blocking (the beacon ignores the
  // response either way). This is NOT the fail-open path.
  const batch = await validateJson(c, EventBatchSchema);

  try {
    // The one reject case (§3b): never write events for an unknown site. The
    // ApiError is rethrown below so it renders the 404 envelope, not fail-open.
    const site = await getSite(c.env.DB, siteId);
    if (!site) {
      throw new ApiError(404, "site_not_found", `No site with id '${siteId}'`);
    }

    const { exposures, conversions } = toRows(siteId, batch.events);

    // Webhook outbox wiring (D4): if a webhook is enabled for this site, append
    // one delivery row to the SAME batch as the event rows. Atomic with the event
    // write: if the batch throws, both events and the outbox row are dropped
    // together — preserving fail-open and never forwarding an unperisted event.
    // At-least-once delivery: a retried beacon's events hit INSERT OR IGNORE
    // (deduped) but still produce a new outbox row (new deliveryId). The payload
    // carries each event's idempotency key so the receiver deduplicates.
    const extraStmts: D1PreparedStatement[] = [];
    if (site.webhook_enabled) {
      const scope = site.webhook_events;
      const webhookEvents =
        scope === "conversions"
          ? batch.events.filter((e) => e.type === "conversion")
          : batch.events;

      if (webhookEvents.length > 0) {
        const deliveryId = crypto.randomUUID();
        const now = Date.now();
        extraStmts.push(
          insertWebhookDelivery(c.env.DB, {
            id: deliveryId,
            site_id: siteId,
            payload: JSON.stringify({ siteId, deliveryId, events: webhookEvents }),
            attempts: 0,
            next_attempt_at: now,
            created_at: now,
          }),
        );
      }
    }

    await insertEvents(c.env.DB, exposures, conversions, extraStmts);
    return c.json({ accepted: batch.events.length }, 202);
  } catch (err) {
    // Unknown site is a deliberate reject — let it become the 404 envelope.
    if (err instanceof ApiError) throw err;
    // FAIL-OPEN (§6): any store failure (write ceiling, transient D1 error) →
    // drop the events and still return 2xx. Losing a beacon is acceptable;
    // blocking the page or triggering a retry storm is not.
    return c.json({ accepted: 0, dropped: batch.events.length }, 202);
  }
});
