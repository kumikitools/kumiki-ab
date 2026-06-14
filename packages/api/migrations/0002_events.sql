-- Kumiki A/B event store (ARCHITECTURE.md §2b/§3b) — the high-volume, append-only
-- write path behind the public beacon `POST /v1/e/:siteId` (D1).
--
-- Two append-only tables, one per logical event shape (§2b). Designed to SERVE
-- the user-based windowed results model (§4), which D2 reads directly:
--   - exposed(V)  = first-exposure-per-(test,visitor) → variant
--   - converted(V)= visitors in exposed(V) with a conversion in [exp_ts, exp_ts+W]
--
-- Dedup (§3b): the client supplies an idempotency key per event; (site_id, key)
-- is the PRIMARY KEY, so a retried beacon's rows collide and INSERT OR IGNORE
-- drops them — no double-counting. Dedup is scoped per-site (the key namespace
-- is the snippet install, i.e. the site).

CREATE TABLE exposure (
  site_id         TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,        -- client-supplied; INSERT OR IGNORE dedups retries
  test_id         TEXT NOT NULL,
  variant_id      TEXT NOT NULL,
  visitor_id      TEXT NOT NULL,        -- opaque bucket id (not PII)
  ts              INTEGER NOT NULL,     -- client event time, epoch ms
  PRIMARY KEY (site_id, idempotency_key)
);

-- §4 exposed(V): scan a test's exposures and take the earliest ts per visitor to
-- assign the sticky variant. (test_id, visitor_id, ts) makes that a single
-- ordered range scan.
CREATE INDEX idx_exposure_test_visitor ON exposure (test_id, visitor_id, ts);

CREATE TABLE conversion (
  site_id         TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  goal            TEXT NOT NULL,        -- variant-agnostic; join is at read time (§2b)
  visitor_id      TEXT NOT NULL,
  ts              INTEGER NOT NULL,     -- client event time, epoch ms
  value           REAL,                 -- optional revenue
  PRIMARY KEY (site_id, idempotency_key)
);

-- §4 windowed join: look up a converting visitor's events within the site,
-- filtered/ordered by ts against each visitor's first-exposure time.
CREATE INDEX idx_conversion_visitor ON conversion (site_id, visitor_id, ts);
