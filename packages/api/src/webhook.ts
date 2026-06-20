import type { Env, DueDeliveryRow } from "./env";
import {
  getDueDeliveries,
  deleteWebhookDelivery,
  rescheduleWebhookDelivery,
} from "./db";

/**
 * Webhook delivery drain (D4, ARCHITECTURE.md §4 "Outbound integrations").
 * Called from the `scheduled()` Cron Trigger in `index.ts` (every minute).
 *
 * Each call picks up to BATCH_LIMIT due outbox rows, delivers them, and
 * updates their state atomically. HTTP deliveries use the global `fetch`, which
 * is stubbable in tests (no real outbound in tests — the card's DoD).
 */

/** Maximum delivery attempts before a row is dropped. */
export const MAX_ATTEMPTS = 8;

/** Maximum rows to process per cron invocation (stays under the 50-fetch cap). */
export const BATCH_LIMIT = 40;

/**
 * HMAC-SHA256 the payload string with the site's webhook secret.
 * Returns lowercase hex — matches the `sha256=<hex>` convention used by GitHub,
 * Stripe, and other webhook providers so receivers can use existing libraries.
 */
export async function signPayload(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Deliver one outbox row. Throws on any non-2xx or network error so the caller
 * can reschedule. Uses the global `fetch` (injectable / stubbable in tests by
 * replacing `globalThis.fetch`).
 */
async function deliverOne(row: DueDeliveryRow): Promise<void> {
  const now = Date.now();
  const body = row.payload;
  const sig = await signPayload(row.webhook_secret, body);

  const res = await fetch(row.webhook_url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kumiki-signature": `sha256=${sig}`,
      "x-kumiki-timestamp": String(now),
      "x-kumiki-delivery-id": row.id,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`webhook delivery failed: HTTP ${res.status}`);
  }
}

/**
 * Exponential backoff with a light per-row jitter derived from the delivery id.
 * Base 60s, doubles per attempt, caps at 1h. The jitter (0–9%) spreads bursts
 * of simultaneous failures so they don't all retry at the exact same second.
 */
function backoffMs(attempts: number, rowId: string): number {
  const base = 60_000;
  const cap = 3_600_000;
  const delay = Math.min(base * Math.pow(2, attempts), cap);
  const jitter = (rowId.charCodeAt(0) % 10) / 100;
  return Math.round(delay * (1 + jitter));
}

/**
 * Drain the webhook outbox: pick due rows, deliver, update state.
 * Called with `ctx.waitUntil(drainWebhooks(env))` from `scheduled()` so it
 * runs after the cron response is sent and doesn't block the next invocation.
 */
export async function drainWebhooks(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await getDueDeliveries(env.DB, now, BATCH_LIMIT);
  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await deliverOne(row);
      await deleteWebhookDelivery(env.DB, row.id);
    } catch {
      const newAttempts = row.attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        await deleteWebhookDelivery(env.DB, row.id);
      } else {
        await rescheduleWebhookDelivery(
          env.DB,
          row.id,
          newAttempts,
          now + backoffMs(newAttempts, row.id),
        );
      }
    }
  }
}
