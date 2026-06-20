import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";
import type { Results } from "@kumikitools/schema";

// Milestone D2 — GET /v1/tests/:id/results, the user-based windowed beta-binomial
// summary (ARCH §4). The READ side that closes the agent-native loop. Each
// isolated D1 run is re-seeded per test, so we mint the site/test/variants and
// the event rows fresh, then assert EXACT exposed/converted counts (the SQL's
// first-exposure assignment + windowed join) plus posterior sanity.
const SITE_ID = "site_res";
const TEST_ID = "tst_res";
const WRITE_KEY = "ksk_reskey_0123456789abcd";
const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const WINDOW_DAYS = 7;

/** Seed site + a 2-variant test (control, v1) with a 7-day conversion window. */
async function seedFixture(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(SITE_ID, "Results Site", await sha256Hex(WRITE_KEY), T0)
    .run();
  await env.DB.prepare(
    `INSERT INTO test (id, site_id, name, status, coverage, winner,
       conversion_window_days, url_match, created_at, updated_at)
     VALUES (?, ?, ?, 'running', 1, NULL, ?, NULL, ?, ?)`,
  )
    .bind(TEST_ID, SITE_ID, "Hero CTA", WINDOW_DAYS, T0, T0)
    .run();
  for (const [id, position] of [
    ["control", 0],
    ["v1", 1],
  ] as const) {
    await env.DB.prepare(
      "INSERT INTO variant (id, test_id, weight, changes, position) VALUES (?, ?, 1, '[]', ?)",
    )
      .bind(id, TEST_ID, position)
      .run();
  }
}

async function addExposure(
  key: string,
  visitorId: string,
  variantId: string,
  ts: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO exposure (site_id, idempotency_key, test_id, variant_id, visitor_id, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(SITE_ID, key, TEST_ID, variantId, visitorId, ts)
    .run();
}

async function addConversion(
  key: string,
  visitorId: string,
  ts: number,
  value: number | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO conversion (site_id, idempotency_key, goal, visitor_id, ts, value)
     VALUES (?, ?, 'purchase', ?, ?, ?)`,
  )
    .bind(SITE_ID, key, visitorId, ts, value)
    .run();
}

function getResults(testId = TEST_ID, key = WRITE_KEY): Promise<Response> {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  return Promise.resolve(
    app.request(`/v1/tests/${testId}/results`, { method: "GET", headers }, env),
  );
}

beforeEach(seedFixture);

describe("D2 GET /v1/tests/:id/results — counts", () => {
  it("assigns by first exposure and credits only in-window conversions", async () => {
    // control: vis1 (converts), vis3 (no conv), vis5 (out-of-window convs only)
    await addExposure("e1", "vis1", "control", T0);
    await addConversion("cv1", "vis1", T0 + DAY); // in window → counts

    await addExposure("e3", "vis3", "control", T0); // exposed, never converts

    await addExposure("e5", "vis5", "control", T0);
    await addConversion("cv5a", "vis5", T0 - 3_600_000); // pre-exposure → excluded
    await addConversion("cv5b", "vis5", T0 + 8 * DAY); // after window → excluded

    // v1: vis2 (converts), vis4 (first-exposed v1 then re-exposed control), vis6 (boundary)
    await addExposure("e2", "vis2", "v1", T0);
    await addConversion("cv2", "vis2", T0 + DAY);

    await addExposure("e4a", "vis4", "v1", T0); // FIRST exposure → assigned v1
    await addExposure("e4b", "vis4", "control", T0 + 3_600_000); // later re-exposure ignored
    await addConversion("cv4", "vis4", T0 + 2 * DAY); // credited to v1

    await addExposure("e6", "vis6", "v1", T0);
    await addConversion("cv6", "vis6", T0 + WINDOW_DAYS * DAY); // exactly at boundary → counts

    const res = await getResults();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Results;

    expect(body.testId).toBe(TEST_ID);
    expect(body.windowDays).toBe(WINDOW_DAYS);

    const control = body.variants.find((v) => v.id === "control")!;
    const v1 = body.variants.find((v) => v.id === "v1")!;

    // First-exposure assignment: vis4's re-exposure to control does NOT add to
    // control's exposed and vis4 is credited to v1.
    expect(control).toMatchObject({ exposed: 3, converted: 1 });
    expect(v1).toMatchObject({ exposed: 3, converted: 3 });
    expect(control.rate).toBeCloseTo(1 / 3, 10);
    expect(v1.rate).toBe(1);
  });

  it("matches the §4 output shape (per-variant fields + pBest sums ~1)", async () => {
    await addExposure("e1", "vis1", "control", T0);
    await addExposure("e2", "vis2", "v1", T0);
    await addConversion("cv2", "vis2", T0 + DAY);

    const body = (await getResults().then((r) => r.json())) as Results;

    expect(body.variants).toHaveLength(2);
    for (const v of body.variants) {
      expect(v).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          exposed: expect.any(Number),
          converted: expect.any(Number),
          rate: expect.any(Number),
          pBest: expect.any(Number),
        }),
      );
      expect(v.ci95).toHaveLength(2);
      expect(v.ci95[0]).toBeLessThanOrEqual(v.ci95[1]);
      // No revenue tracked → field omitted.
      expect(v.revPerVisitor).toBeUndefined();
    }
    const totalPBest = body.variants.reduce((s, v) => s + v.pBest, 0);
    expect(totalPBest).toBeCloseTo(1, 5);
  });

  it("includes a variant with zero exposures (from the test's variant list)", async () => {
    await addExposure("e1", "vis1", "control", T0); // only control sees traffic
    const body = (await getResults().then((r) => r.json())) as Results;
    const v1 = body.variants.find((v) => v.id === "v1")!;
    expect(v1).toMatchObject({ exposed: 0, converted: 0, rate: 0 });
  });
});

describe("D2 GET /v1/tests/:id/results — posterior + revenue", () => {
  it("yields high pBest and a winner for a clearly-better variant", async () => {
    // Bulk lopsided traffic: control ~5%, v1 ~15% over 400 visitors each.
    for (let i = 0; i < 400; i++) {
      await addExposure(`ec${i}`, `c${i}`, "control", T0);
      if (i < 20) await addConversion(`cc${i}`, `c${i}`, T0 + DAY); // 5%
      await addExposure(`ev${i}`, `t${i}`, "v1", T0);
      if (i < 60) await addConversion(`cvv${i}`, `t${i}`, T0 + DAY); // 15%
    }

    const body = (await getResults().then((r) => r.json())) as Results;
    const v1 = body.variants.find((v) => v.id === "v1")!;
    expect(v1.exposed).toBe(400);
    expect(v1.converted).toBe(60);
    expect(v1.pBest).toBeGreaterThan(0.99);
    expect(body.winner).toBe("v1");
  });

  it("reports revPerVisitor when conversions carry a value", async () => {
    await addExposure("e1", "vis1", "control", T0);
    await addConversion("cv1", "vis1", T0 + DAY, 50); // revenue 50

    await addExposure("e2", "vis2", "v1", T0);
    await addConversion("cv2", "vis2", T0 + DAY, 100);
    await addExposure("e3", "vis3", "v1", T0); // exposed, no conversion

    const body = (await getResults().then((r) => r.json())) as Results;
    const control = body.variants.find((v) => v.id === "control")!;
    const v1 = body.variants.find((v) => v.id === "v1")!;
    expect(control.revPerVisitor).toBeCloseTo(50, 10); // 50 / 1 exposed
    expect(v1.revPerVisitor).toBeCloseTo(50, 10); // 100 / 2 exposed
  });
});

describe("D2 GET /v1/tests/:id/results — auth", () => {
  it("401 without a key, 403 with a wrong key", async () => {
    expect((await getResults(TEST_ID, "")).status).toBe(401);
    expect((await getResults(TEST_ID, "ksk_wrong")).status).toBe(403);
  });

  it("404s an unknown test", async () => {
    const res = await getResults("tst_ghost");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("test_not_found");
  });

  it("isolates sites: another site's key cannot read these results (403)", async () => {
    const otherRes = await app.request(
      "/v1/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Other" }),
      },
      env,
    );
    const other = (await otherRes.json()) as { writeKey: string };
    expect((await getResults(TEST_ID, other.writeKey)).status).toBe(403);
  });
});
