/**
 * Worker bindings (ARCHITECTURE.md §3). One Worker fronts all three surfaces, so
 * every binding lives on this single Env. Keep it minimal — add a binding only
 * when a surface genuinely needs it (the event store, §2b, lands here later).
 */
export interface Env {
  /** Config store — D1/SQLite (§2a). */
  DB: D1Database;
}

/** Hono context variables set by middleware (see auth.ts). */
export interface Variables {
  /** The authenticated site, set by `siteAuth` (and `testAuth`) on control routes. */
  site: SiteRow;
  /** The authenticated test, set by `testAuth` on test-scoped routes (B2–B6). */
  test: TestRow;
}

/** A row of the `site` table (including webhook config from migration 0003). */
export interface SiteRow {
  id: string;
  name: string;
  api_key_hash: string;
  created_at: number;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_enabled: number;  // SQLite INTEGER: 0 = disabled, 1 = enabled
  webhook_events: string;   // "all" | "conversions"
}

/** A row of the `webhook_delivery` outbox table (migration 0003). */
export interface WebhookDeliveryRow {
  id: string;
  site_id: string;
  payload: string;          // JSON: { siteId, deliveryId, events }
  attempts: number;
  next_attempt_at: number;  // epoch ms
  created_at: number;       // epoch ms
}

/** `webhook_delivery` joined with its site's webhook config — used by the drain. */
export interface DueDeliveryRow extends WebhookDeliveryRow {
  webhook_url: string;
  webhook_secret: string;
}

/** A row of the `test` table. */
export interface TestRow {
  id: string;
  site_id: string;
  name: string;
  status: string;
  coverage: number | null;
  winner: string | null;
  conversion_window_days: number;
  url_match: string | null;
  created_at: number;
  updated_at: number;
}

/** A row of the `variant` table. */
export interface VariantRow {
  id: string;
  test_id: string;
  weight: number;
  changes: string;
  position: number;
}

/** A row of the `exposure` event-store table (§2b). */
export interface ExposureRow {
  site_id: string;
  idempotency_key: string;
  test_id: string;
  variant_id: string;
  visitor_id: string;
  ts: number;
}

/** A row of the `conversion` event-store table (§2b). `value` is optional revenue. */
export interface ConversionRow {
  site_id: string;
  idempotency_key: string;
  goal: string;
  visitor_id: string;
  ts: number;
  value: number | null;
}

/** The Hono generics every route/middleware in this package is typed against. */
export interface AppBindings {
  Bindings: Env;
  Variables: Variables;
}
