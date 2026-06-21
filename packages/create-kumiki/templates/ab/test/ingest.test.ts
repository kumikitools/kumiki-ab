import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";

// Milestone D1 — the public ingestion beacon (POST /v1/e/:siteId), the event
// store's first write surface. Mirrors control.test.ts: each isolated D1 run is
// re-seeded per test (apply-migrations.ts), so we mint the site fresh. Ingestion
// is PUBLIC (no write key), so requests carry no auth header.
const SITE_ID = "site_ingest";

async function seedSite(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(SITE_ID, "Ingest Site", await sha256Hex("ksk_unused"), 1_700_000_000_000)
    .run();
}

/** POST a beacon batch to the ingestion endpoint. `envOverride` swaps bindings
 *  (used to inject a failing D1 for the fail-open path). */
function beacon(
  siteId: string,
  body: unknown,
  envOverride: typeof env = env,
): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/v1/e/${siteId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      envOverride,
    ),
  );
}

const exposure = (over: Record<string, unknown> = {}) => ({
  type: "exposure",
  key: "exp_1",
  ts: 1_700_000_001_000,
  visitorId: "vis_a",
  testId: "tst_x",
  variantId: "v1",
  ...over,
});

const conversion = (over: Record<string, unknown> = {}) => ({
  type: "conversion",
  key: "conv_1",
  ts: 1_700_000_002_000,
  visitorId: "vis_a",
  goal: "purchase",
  value: 42,
  ...over,
});

async function countRows(table: "exposure" | "conversion"): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE site_id = ?`,
  )
    .bind(SITE_ID)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(seedSite);

describe("D1 POST /v1/e/:siteId — persist", () => {
  it("persists a batched beacon of exposures + conversions", async () => {
    const res = await beacon(SITE_ID, {
      events: [
        exposure(),
        exposure({ key: "exp_2", visitorId: "vis_b", variantId: "control" }),
        conversion(),
      ],
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 3 });

    expect(await countRows("exposure")).toBe(2);
    expect(await countRows("conversion")).toBe(1);

    // Rows are written with the path siteId and the event fields intact.
    const exp = await env.DB.prepare(
      "SELECT * FROM exposure WHERE idempotency_key = ?",
    )
      .bind("exp_1")
      .first<{ test_id: string; variant_id: string; visitor_id: string; ts: number }>();
    expect(exp).toMatchObject({
      test_id: "tst_x",
      variant_id: "v1",
      visitor_id: "vis_a",
      ts: 1_700_000_001_000,
    });

    const conv = await env.DB.prepare(
      "SELECT value FROM conversion WHERE idempotency_key = ?",
    )
      .bind("conv_1")
      .first<{ value: number }>();
    expect(conv?.value).toBe(42);
  });

  it("stores a conversion with no value as NULL", async () => {
    const { value, ...noValue } = conversion();
    void value;
    await beacon(SITE_ID, { events: [noValue] });
    const conv = await env.DB.prepare(
      "SELECT value FROM conversion WHERE idempotency_key = ?",
    )
      .bind("conv_1")
      .first<{ value: number | null }>();
    expect(conv?.value).toBeNull();
  });
});

describe("D1 POST /v1/e/:siteId — idempotency dedup", () => {
  it("dedups a replayed beacon by idempotency key (no double rows)", async () => {
    const batch = { events: [exposure(), conversion()] };

    const first = await beacon(SITE_ID, batch);
    expect(first.status).toBe(202);
    expect(await countRows("exposure")).toBe(1);
    expect(await countRows("conversion")).toBe(1);

    // Re-POST the identical batch — a retried beacon. Still 2xx, but no new rows.
    const replay = await beacon(SITE_ID, batch);
    expect(replay.status).toBe(202);
    expect(await countRows("exposure")).toBe(1);
    expect(await countRows("conversion")).toBe(1);
  });

  it("dedups duplicate keys within a single batch", async () => {
    await beacon(SITE_ID, {
      events: [exposure(), exposure({ visitorId: "vis_z", variantId: "control" })],
    });
    // Same key twice in one batch → only the first row lands.
    expect(await countRows("exposure")).toBe(1);
  });

  it("scopes dedup per-site: the same key under another site is a distinct row", async () => {
    await env.DB.prepare(
      "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind("site_other", "Other", await sha256Hex("ksk_x"), 1_700_000_000_000)
      .run();

    await beacon(SITE_ID, { events: [exposure()] });
    await beacon("site_other", { events: [exposure()] });

    expect(await countRows("exposure")).toBe(1);
    const other = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM exposure WHERE site_id = ?",
    )
      .bind("site_other")
      .first<{ n: number }>();
    expect(other?.n).toBe(1);
  });
});

describe("D1 POST /v1/e/:siteId — fail-open", () => {
  it("fails open on a write failure: 2xx, events dropped, page never blocked", async () => {
    // Inject a D1 whose reads (getSite) still work but whose batch write throws,
    // so we exercise the write-failure path specifically (not the site lookup).
    const failingDb = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: () => Promise.reject(new Error("simulated D1 write ceiling")),
    } as unknown as D1Database;
    const failingEnv = { ...env, DB: failingDb };

    const res = await beacon(SITE_ID, { events: [exposure(), conversion()] }, failingEnv);
    // Fail-open: still 2xx so the snippet never retry-storms or blocks the page.
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 0, dropped: 2 });

    // Nothing was written — the events were dropped, not queued.
    expect(await countRows("exposure")).toBe(0);
    expect(await countRows("conversion")).toBe(0);
  });
});

describe("D1 POST /v1/e/:siteId — guards", () => {
  it("rejects an unknown site (404, NOT fail-open)", async () => {
    const res = await beacon("site_nope", { events: [exposure()] });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("site_not_found");
  });

  it("rejects a malformed body with 400 invalid_body", async () => {
    expect((await beacon(SITE_ID, { events: [] })).status).toBe(400);
    expect((await beacon(SITE_ID, "not json")).status).toBe(400);
    const res = await beacon(SITE_ID, {
      events: [{ type: "exposure", key: "k", ts: 1, visitorId: "v" }], // missing testId/variantId
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("rejects a batch over the size cap with 400", async () => {
    const events = Array.from({ length: 101 }, (_, i) => exposure({ key: `k_${i}` }));
    const res = await beacon(SITE_ID, { events });
    expect(res.status).toBe(400);
  });
});
