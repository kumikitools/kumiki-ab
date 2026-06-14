import { Hono } from "hono";
import type { AppBindings, TestRow, VariantRow } from "../env";
import { siteAuth } from "../auth";
import { insertTestWithVariants, getTestWithVariants } from "../db";
import { CreateTestRequestSchema, validateJson } from "../validation";
import { serializeTest } from "../serialize";

/**
 * THE REFERENCE CONTROL ROUTE (A2). Every other control route (B1–B6) follows
 * this exact shape:
 *   1. mount under `:id` and gate with `siteAuth()`  → c.get("site") is verified
 *   2. `validateJson` the body against a zod schema   → 400 envelope on failure
 *   3. translate the request into D1 rows, write atomically via the db helper
 *   4. read back and return the serialized resource   → never echo the request
 *
 * `POST /v1/sites/:id/tests` — create a test (with its variants) under a site.
 */
export const tests = new Hono<AppBindings>();

tests.post("/:id/tests", siteAuth(), async (c) => {
  const site = c.get("site");
  const body = await validateJson(c, CreateTestRequestSchema);

  const now = Date.now();
  const testId = body.id ?? `tst_${crypto.randomUUID()}`;

  const testRow: TestRow = {
    id: testId,
    site_id: site.id,
    name: body.name,
    status: body.status,
    coverage: body.coverage ?? null,
    winner: body.winner ?? null,
    conversion_window_days: body.conversionWindowDays,
    url_match: body.urlMatch ? JSON.stringify(body.urlMatch) : null,
    created_at: now,
    updated_at: now,
  };

  const variantRows: VariantRow[] = body.variants.map((v, i) => ({
    id: v.id,
    test_id: testId,
    weight: v.weight,
    changes: JSON.stringify(v.changes ?? []),
    position: i,
  }));

  await insertTestWithVariants(c.env.DB, testRow, variantRows);

  // Read back through the same path the GET routes will use, so the create
  // response and a later fetch are byte-identical.
  const stored = await getTestWithVariants(c.env.DB, testId);
  if (!stored) {
    // Should be unreachable — the write above succeeded in one transaction.
    throw new Error("test vanished immediately after insert");
  }

  return c.json(serializeTest(stored.test, stored.variants), 201);
});
