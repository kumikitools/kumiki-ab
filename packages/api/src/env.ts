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
  /** The authenticated site, set by `siteAuth` on control routes. */
  site: SiteRow;
}

/** A row of the `site` table. */
export interface SiteRow {
  id: string;
  name: string;
  api_key_hash: string;
  created_at: number;
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

/** The Hono generics every route/middleware in this package is typed against. */
export interface AppBindings {
  Bindings: Env;
  Variables: Variables;
}
