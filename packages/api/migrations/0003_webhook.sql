-- Webhook outbox (ARCHITECTURE.md §4 "Outbound integrations"). Adds per-site
-- webhook config to the `site` table (one webhook per site at MVP) and an outbox
-- table that the Cron Trigger drains with retry/backoff.
--
-- Config columns on `site`:
--   webhook_url     — HTTPS destination URL (NULL = not configured)
--   webhook_secret  — stored plaintext (HMAC needs the raw value, not a hash);
--                     acceptable on the operator's own self-hosted D1 (§7)
--   webhook_enabled — 0 = disabled, 1 = enabled (INTEGER for SQLite bool)
--   webhook_events  — delivery scope: "all" | "conversions" (default: "all")
--
-- webhook_delivery outbox — one row per in-flight beacon batch:
--   id              — the deliveryId (UUID); also the X-Kumiki-Delivery-Id header
--   site_id         — owning site (join back to get url/secret at drain time)
--   payload         — JSON string { siteId, deliveryId, events } — the POST body
--   attempts        — delivery attempts so far (0 = never tried)
--   next_attempt_at — epoch ms; drain picks rows WHERE next_attempt_at <= now()
--   created_at      — epoch ms; for debugging / TTL cleanup

ALTER TABLE site ADD COLUMN webhook_url     TEXT;
ALTER TABLE site ADD COLUMN webhook_secret  TEXT;
ALTER TABLE site ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site ADD COLUMN webhook_events  TEXT    NOT NULL DEFAULT 'all';

CREATE TABLE webhook_delivery (
  id              TEXT    NOT NULL,
  site_id         TEXT    NOT NULL,
  payload         TEXT    NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (id)
);

-- Drain query: scan by next_attempt_at to find due rows efficiently.
CREATE INDEX idx_webhook_delivery_due ON webhook_delivery (next_attempt_at);
