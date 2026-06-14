import { Hono } from "hono";
import type { Context } from "hono";
import type { AppBindings, TestRow, VariantRow } from "../env";
import { testAuth } from "../auth";
import { ApiError } from "../errors";
import {
  getTestWithVariants,
  getTestResultCounts,
  updateTest,
  replaceVariants,
} from "../db";
import {
  PatchTestRequestSchema,
  ReplaceVariantsRequestSchema,
  ApplyTestRequestSchema,
  validateJson,
} from "../validation";
import { serializeTest, serializeResults } from "../serialize";
import { computePosteriors, type VariantCounts } from "../stats";
import { purgeSiteCache } from "../cache";

/** Days → ms, the unit the event store stamps `ts` in (epoch ms). */
const MS_PER_DAY = 86_400_000;

/**
 * Test-scoped control routes (B2–B6, ARCH §3c). Mounted under `/v1/tests`, so
 * here `:id` is a **testId** — every route is gated by `testAuth()`, which loads
 * the test, verifies the caller's key against the test's owning site, and exposes
 * the verified `test`/`site` on the context.
 *
 * All follow the A2 reference shape: validate → write via a db helper → purge the
 * site cache (B3–B6 mutate the delivered config) → read back through
 * `getTestWithVariants` and return the serialized resource (never echo the input).
 */
export const testById = new Hono<AppBindings>();

/** Re-read a test after a write and serialize it; the row must exist (just written). */
async function readBack(c: Context<AppBindings>, testId: string) {
  const stored = await getTestWithVariants(c.env.DB, testId);
  if (!stored) {
    // Unreachable: testAuth proved the test exists and writes are transactional.
    throw new ApiError(404, "test_not_found", `No test with id '${testId}'`);
  }
  return serializeTest(stored.test, stored.variants);
}

/** B2 `GET /v1/tests/:id` — the full test + its variants. */
testById.get("/:id", testAuth(), async (c) => {
  const test = c.get("test");
  return c.json(await readBack(c, test.id));
});

/**
 * D2 `GET /v1/tests/:id/results` — the user-based, windowed beta-binomial summary
 * (ARCH §4). The READ side that closes the agent-native loop: it reads the D1
 * event store this test has been collecting into.
 *
 * Shape: load the test's variants (the universe to report, incl. zero-exposure
 * arms), aggregate exposed/converted/revenue from the event store over the test's
 * own `conversion_window_days` (`getTestResultCounts`), feed the counts to the
 * pure posterior math (`computePosteriors`), and serialize to the `Results`
 * contract. The route stays thin — SQL in db.ts, math in stats.ts, shape in
 * serialize.ts.
 */
testById.get("/:id/results", testAuth(), async (c) => {
  const test = c.get("test");
  const stored = await getTestWithVariants(c.env.DB, test.id);
  if (!stored) {
    // Unreachable: testAuth proved the test exists.
    throw new ApiError(404, "test_not_found", `No test with id '${test.id}'`);
  }

  const windowMs = test.conversion_window_days * MS_PER_DAY;
  const rows = await getTestResultCounts(c.env.DB, test.id, test.site_id, windowMs);
  const byVariant = new Map(rows.map((r) => [r.variant_id, r]));

  // Report only the test's current variants; orphan exposure rows (variants since
  // removed) are ignored. Include revenue only when the test tracked any, so the
  // optional revPerVisitor field is present on all variants or none.
  const hasRevenue = rows.some((r) => r.revenue_visitors > 0);
  const counts: VariantCounts[] = stored.variants.map((v) => {
    const row = byVariant.get(v.id);
    return {
      id: v.id,
      exposed: row?.exposed ?? 0,
      converted: row?.converted ?? 0,
      ...(hasRevenue ? { revenue: row?.revenue ?? 0 } : {}),
    };
  });

  const posterior = computePosteriors(counts);
  return c.json(serializeResults(test.id, test.conversion_window_days, posterior));
});

/** B3 `PATCH /v1/tests/:id` — partial edit of status / coverage / window / name / targeting. */
testById.patch("/:id", testAuth(), async (c) => {
  const test = c.get("test");
  const body = await validateJson(c, PatchTestRequestSchema);

  const patch: Partial<
    Pick<
      TestRow,
      "name" | "status" | "coverage" | "conversion_window_days" | "url_match"
    >
  > = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.status !== undefined) patch.status = body.status;
  if (body.coverage !== undefined) patch.coverage = body.coverage;
  if (body.conversionWindowDays !== undefined)
    patch.conversion_window_days = body.conversionWindowDays;
  if (body.urlMatch !== undefined) patch.url_match = JSON.stringify(body.urlMatch);

  await updateTest(c.env.DB, test.id, patch, Date.now());
  await purgeSiteCache(test.site_id);

  return c.json(await readBack(c, test.id));
});

/** B4 `PUT /v1/tests/:id/variants` — replace the whole variant set (editor save). */
testById.put("/:id/variants", testAuth(), async (c) => {
  const test = c.get("test");
  const body = await validateJson(c, ReplaceVariantsRequestSchema);

  const variantRows: VariantRow[] = body.variants.map((v, i) => ({
    id: v.id,
    test_id: test.id,
    weight: v.weight,
    changes: JSON.stringify(v.changes ?? []),
    position: i,
  }));

  await replaceVariants(c.env.DB, test.id, variantRows, Date.now());
  await purgeSiteCache(test.site_id);

  return c.json(await readBack(c, test.id));
});

/**
 * B5 `POST /v1/tests/:id/apply` `{ winner }` — roll the winner to 100% (status →
 * applied). A deliberate, reversible guardrail action (ARCH §3c). The winner must
 * name a real variant of this test; that's a DB check, so it lives here.
 */
testById.post("/:id/apply", testAuth(), async (c) => {
  const test = c.get("test");
  const body = await validateJson(c, ApplyTestRequestSchema);

  const stored = await getTestWithVariants(c.env.DB, test.id);
  if (!stored) {
    throw new ApiError(404, "test_not_found", `No test with id '${test.id}'`);
  }
  const ids = stored.variants.map((v) => v.id);
  if (!ids.includes(body.winner)) {
    throw new ApiError(
      400,
      "unknown_winner",
      `winner '${body.winner}' is not a variant of test '${test.id}'`,
    );
  }

  await updateTest(
    c.env.DB,
    test.id,
    { status: "applied", winner: body.winner },
    Date.now(),
  );
  await purgeSiteCache(test.site_id);

  return c.json(await readBack(c, test.id));
});

/** B6 `POST /v1/tests/:id/stop` — the instant kill switch (status → stopped, cache purged). */
testById.post("/:id/stop", testAuth(), async (c) => {
  const test = c.get("test");

  await updateTest(c.env.DB, test.id, { status: "stopped" }, Date.now());
  await purgeSiteCache(test.site_id);

  return c.json(await readBack(c, test.id));
});
