import type {
  ConversionRow,
  ExposureRow,
  SiteRow,
  TestRow,
  VariantRow,
} from "./env";

/**
 * D1 access helper — the ONE place that knows table/column names and SQL. Reference
 * pattern: routes call these typed functions, never inline `db.prepare(...)`. This
 * keeps SQL reviewable in one file and the routes readable.
 *
 * Writes that must be atomic across tables use `db.batch([...])` (a single D1
 * transaction).
 */

export async function getSite(
  db: D1Database,
  siteId: string,
): Promise<SiteRow | null> {
  return db
    .prepare("SELECT * FROM site WHERE id = ?")
    .bind(siteId)
    .first<SiteRow>();
}

export async function insertSite(db: D1Database, site: SiteRow): Promise<void> {
  await db
    .prepare(
      "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(site.id, site.name, site.api_key_hash, site.created_at)
    .run();
}

/** Insert a test and its variants atomically (one D1 transaction). */
export async function insertTestWithVariants(
  db: D1Database,
  test: TestRow,
  variants: VariantRow[],
): Promise<void> {
  const testStmt = db
    .prepare(
      `INSERT INTO test
         (id, site_id, name, status, coverage, winner,
          conversion_window_days, url_match, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      test.id,
      test.site_id,
      test.name,
      test.status,
      test.coverage,
      test.winner,
      test.conversion_window_days,
      test.url_match,
      test.created_at,
      test.updated_at,
    );

  const variantStmt = db.prepare(
    `INSERT INTO variant (id, test_id, weight, changes, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const variantStmts = variants.map((v) =>
    variantStmt.bind(v.id, v.test_id, v.weight, v.changes, v.position),
  );

  await db.batch([testStmt, ...variantStmts]);
}

/** Load a single test row (no variants) — the read `testAuth` gates B2–B6 on. */
export async function getTest(
  db: D1Database,
  testId: string,
): Promise<TestRow | null> {
  return db
    .prepare("SELECT * FROM test WHERE id = ?")
    .bind(testId)
    .first<TestRow>();
}

/**
 * Partial-update a test's mutable columns (B3 edit, B5 apply, B6 stop). `patch`
 * is keyed by DB column — only the keys present are written, plus `updated_at`.
 * The key set is a fixed `Pick`, so the dynamic `SET` clause can never carry
 * caller-controlled column names (no injection surface).
 */
export async function updateTest(
  db: D1Database,
  testId: string,
  patch: Partial<
    Pick<
      TestRow,
      "name" | "status" | "coverage" | "winner" | "conversion_window_days" | "url_match"
    >
  >,
  updatedAt: number,
): Promise<void> {
  const cols = Object.keys(patch) as (keyof typeof patch)[];
  const sets = cols.map((col) => `${col} = ?`);
  sets.push("updated_at = ?");
  const values: (string | number | null)[] = cols.map((col) => patch[col] ?? null);
  values.push(updatedAt, testId);

  await db
    .prepare(`UPDATE test SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Replace a test's entire variant set (B4 — the editor's save). Deletes the old
 * variants, inserts the new ones at their authoring positions, and bumps the
 * test's `updated_at`, all atomically in one D1 transaction.
 */
export async function replaceVariants(
  db: D1Database,
  testId: string,
  variants: VariantRow[],
  updatedAt: number,
): Promise<void> {
  const del = db.prepare("DELETE FROM variant WHERE test_id = ?").bind(testId);

  const insertStmt = db.prepare(
    `INSERT INTO variant (id, test_id, weight, changes, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const inserts = variants.map((v) =>
    insertStmt.bind(v.id, v.test_id, v.weight, v.changes, v.position),
  );

  const bump = db
    .prepare("UPDATE test SET updated_at = ? WHERE id = ?")
    .bind(updatedAt, testId);

  await db.batch([del, ...inserts, bump]);
}

/** Load a test with its variants ordered by authoring position. */
export async function getTestWithVariants(
  db: D1Database,
  testId: string,
): Promise<{ test: TestRow; variants: VariantRow[] } | null> {
  const test = await db
    .prepare("SELECT * FROM test WHERE id = ?")
    .bind(testId)
    .first<TestRow>();
  if (!test) return null;

  const { results } = await db
    .prepare("SELECT * FROM variant WHERE test_id = ? ORDER BY position ASC")
    .bind(testId)
    .all<VariantRow>();

  return { test, variants: results };
}

/**
 * Load every test of a site with its variants — the read for the delivery
 * surface (A3, ARCH §3a), flattened into `KumikiConfig` by `serializeConfig`.
 *
 * Two queries (tests, then all their variants via a join) grouped in memory, so
 * the whole site config is one round-trip pair regardless of test count. Tests
 * are ordered deterministically (created_at, then id as a tiebreak); variants
 * keep authoring `position` within each test.
 */
export async function getTestsWithVariantsForSite(
  db: D1Database,
  siteId: string,
): Promise<{ test: TestRow; variants: VariantRow[] }[]> {
  const { results: tests } = await db
    .prepare(
      "SELECT * FROM test WHERE site_id = ? ORDER BY created_at ASC, id ASC",
    )
    .bind(siteId)
    .all<TestRow>();
  if (tests.length === 0) return [];

  const { results: variants } = await db
    .prepare(
      `SELECT v.* FROM variant v
         JOIN test t ON v.test_id = t.id
        WHERE t.site_id = ?
        ORDER BY v.test_id ASC, v.position ASC`,
    )
    .bind(siteId)
    .all<VariantRow>();

  const byTest = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const arr = byTest.get(v.test_id);
    if (arr) arr.push(v);
    else byTest.set(v.test_id, [v]);
  }

  return tests.map((test) => ({ test, variants: byTest.get(test.id) ?? [] }));
}

/**
 * Append a beacon's events to the event store (D1, ARCH §2b/§3b) — the ingestion
 * write helper, the equivalent of the control writes above but for the hot,
 * public write path.
 *
 * `INSERT OR IGNORE` is the idempotency dedup (§3b): a row whose
 * (site_id, idempotency_key) already exists is silently skipped, so a retried
 * beacon — or a key repeated within one batch — never double-counts. All
 * statements run in one `db.batch` transaction.
 *
 * Callers MUST treat a thrown error as fail-open (drop the events, return 2xx —
 * never block the page; the free-tier write ceiling errors hard, ARCH §6). This
 * helper does not swallow errors; the ingestion route owns that policy.
 */
export async function insertEvents(
  db: D1Database,
  exposures: ExposureRow[],
  conversions: ConversionRow[],
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];

  if (exposures.length > 0) {
    const exposure = db.prepare(
      `INSERT OR IGNORE INTO exposure
         (site_id, idempotency_key, test_id, variant_id, visitor_id, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of exposures) {
      stmts.push(
        exposure.bind(
          r.site_id,
          r.idempotency_key,
          r.test_id,
          r.variant_id,
          r.visitor_id,
          r.ts,
        ),
      );
    }
  }

  if (conversions.length > 0) {
    const conversion = db.prepare(
      `INSERT OR IGNORE INTO conversion
         (site_id, idempotency_key, goal, visitor_id, ts, value)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of conversions) {
      stmts.push(
        conversion.bind(
          r.site_id,
          r.idempotency_key,
          r.goal,
          r.visitor_id,
          r.ts,
          r.value,
        ),
      );
    }
  }

  if (stmts.length > 0) await db.batch(stmts);
}
