import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";
import type { TestResource } from "../src/serialize";

// Each test gets isolated D1 storage seeded from the migrated schema (see
// vitest.config.ts + apply-migrations.ts), so we re-seed the site per test.
const SITE_ID = "site_fixture";
const WRITE_KEY = "ksk_fixturekey_0123456789";

async function seedSite(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(SITE_ID, "Fixture Site", await sha256Hex(WRITE_KEY), 1_700_000_000_000)
    .run();
}

function post(
  path: string,
  opts: { key?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  const body =
    typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {});
  return Promise.resolve(app.request(path, { method: "POST", headers, body }, env));
}

const validBody = {
  name: "Hero CTA color",
  variants: [
    { id: "control", weight: 1 },
    {
      id: "v1",
      weight: 1,
      changes: [{ selector: ".cta", type: "style", value: { color: "red" } }],
    },
  ],
};

beforeEach(seedSite);

describe("POST /v1/sites/:id/tests", () => {
  it("creates a test and persists it to D1", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: WRITE_KEY,
      body: validBody,
    });
    expect(res.status).toBe(201);

    const json = (await res.json()) as TestResource;
    expect(json.id).toMatch(/^tst_/);
    expect(json.siteId).toBe(SITE_ID);
    expect(json.name).toBe("Hero CTA color");
    expect(json.status).toBe("running"); // defaulted
    expect(json.conversionWindowDays).toBe(7); // defaulted
    expect(json.variants).toHaveLength(2);
    expect(json.variants[1].changes).toEqual([
      { selector: ".cta", type: "style", value: { color: "red" } },
    ]);

    // The row really landed in D1.
    const testRow = await env.DB.prepare("SELECT * FROM test WHERE id = ?")
      .bind(json.id)
      .first<{ site_id: string; status: string; conversion_window_days: number }>();
    expect(testRow?.site_id).toBe(SITE_ID);
    expect(testRow?.conversion_window_days).toBe(7);

    const { results: variantRows } = await env.DB.prepare(
      "SELECT * FROM variant WHERE test_id = ? ORDER BY position ASC",
    )
      .bind(json.id)
      .all<{ id: string; position: number }>();
    expect(variantRows.map((v) => v.id)).toEqual(["control", "v1"]);
    expect(variantRows.map((v) => v.position)).toEqual([0, 1]);
  });

  it("honors an explicit test id and non-default fields", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: WRITE_KEY,
      body: {
        id: "my-test",
        name: "Pricing page",
        status: "applied",
        coverage: 0.5,
        conversionWindowDays: 14,
        winner: "control",
        urlMatch: { include: [{ type: "prefix", value: "https://x.com/p" }] },
        variants: [{ id: "control", weight: 1 }],
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as TestResource;
    expect(json.id).toBe("my-test");
    expect(json.status).toBe("applied");
    expect(json.coverage).toBe(0.5);
    expect(json.conversionWindowDays).toBe(14);
    expect(json.winner).toBe("control");
    expect(json.urlMatch).toEqual({
      include: [{ type: "prefix", value: "https://x.com/p" }],
    });
  });

  it("rejects a missing write key with 401", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, { body: validBody });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("missing_key");
  });

  it("rejects a wrong write key with 403", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: "ksk_wrong",
      body: validBody,
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_key");
  });

  it("returns 404 for an unknown site", async () => {
    const res = await post(`/v1/sites/site_does_not_exist/tests`, {
      key: WRITE_KEY,
      body: validBody,
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("site_not_found");
  });

  it("rejects an invalid body (no variants) with a 400 envelope", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: WRITE_KEY,
      body: { name: "no variants", variants: [] },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; details: unknown } };
    expect(json.error.code).toBe("invalid_body");
    expect(json.error.details).toBeDefined();
  });

  it("rejects duplicate variant ids", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: WRITE_KEY,
      body: {
        name: "dupes",
        variants: [
          { id: "v1", weight: 1 },
          { id: "v1", weight: 1 },
        ],
      },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("rejects a winner that is not one of the variants", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: WRITE_KEY,
      body: { ...validBody, status: "applied", winner: "ghost" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400 invalid_json", async () => {
    const res = await post(`/v1/sites/${SITE_ID}/tests`, {
      key: WRITE_KEY,
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_json");
  });
});

describe("POST /v1/sites (bootstrap) → create test end-to-end", () => {
  it("mints a write key that authorizes the create-test route", async () => {
    const siteRes = await post("/v1/sites", { body: { name: "Brand new" } });
    expect(siteRes.status).toBe(201);
    const site = (await siteRes.json()) as { id: string; writeKey: string };
    expect(site.id).toMatch(/^site_/);
    expect(site.writeKey).toMatch(/^ksk_/);

    const testRes = await post(`/v1/sites/${site.id}/tests`, {
      key: site.writeKey,
      body: validBody,
    });
    expect(testRes.status).toBe(201);
    const test = (await testRes.json()) as TestResource;
    expect(test.siteId).toBe(site.id);
  });
});
