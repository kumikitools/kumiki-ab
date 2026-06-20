import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";
import type { KumikiConfig } from "@kumikitools/schema";
import type { TestResource } from "../src/serialize";

// Milestone B — the control-surface breadth (B1 list, B2 get, B3 patch, B4
// replace variants, B5 apply, B6 stop). Each isolated D1 run is re-seeded per
// test (see apply-migrations.ts), so we mint the site + a baseline test fresh.
const SITE_ID = "site_ctrl";
const WRITE_KEY = "ksk_ctrlkey_0123456789abcd";

async function seedSite(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(SITE_ID, "Control Site", await sha256Hex(WRITE_KEY), 1_700_000_000_000)
    .run();
}

function request(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body =
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return Promise.resolve(app.request(path, init, env));
}

const baseTest = {
  id: "tst_base",
  name: "Hero CTA color",
  status: "running",
  coverage: 0.5,
  conversionWindowDays: 7,
  variants: [
    { id: "control", weight: 1 },
    {
      id: "v1",
      weight: 1,
      changes: [{ selector: ".cta", type: "style", value: { color: "red" } }],
    },
  ],
};

/** Create the baseline test under the seeded site via the A2 create route. */
async function seedTest(overrides: Record<string, unknown> = {}): Promise<TestResource> {
  const res = await request("POST", `/v1/sites/${SITE_ID}/tests`, {
    key: WRITE_KEY,
    body: { ...baseTest, ...overrides },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as TestResource;
}

/** Read the delivered config (the cache-backed delivery surface) for the site. */
async function deliveredConfig(): Promise<KumikiConfig> {
  return (await (await request("GET", `/v1/config/${SITE_ID}`)).json()) as KumikiConfig;
}

beforeEach(seedSite);

describe("B1 GET /v1/sites/:id/tests (list)", () => {
  it("returns every test of the site as full control resources", async () => {
    await seedTest({ id: "tst_a" });
    await seedTest({ id: "tst_b", name: "Second" });

    const res = await request("GET", `/v1/sites/${SITE_ID}/tests`, { key: WRITE_KEY });
    expect(res.status).toBe(200);

    const list = (await res.json()) as TestResource[];
    expect(list.map((t) => t.id)).toEqual(["tst_a", "tst_b"]);
    // Full control resource, not the bare contract Test.
    expect(list[0].siteId).toBe(SITE_ID);
    expect(list[0].name).toBe("Hero CTA color");
    expect(list[0].conversionWindowDays).toBe(7);
    expect(list[0].variants).toHaveLength(2);
  });

  it("returns an empty array for a site with no tests", async () => {
    const res = await request("GET", `/v1/sites/${SITE_ID}/tests`, { key: WRITE_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("enforces auth: 401 without key, 403 wrong key, 404 unknown site", async () => {
    expect((await request("GET", `/v1/sites/${SITE_ID}/tests`)).status).toBe(401);
    expect(
      (await request("GET", `/v1/sites/${SITE_ID}/tests`, { key: "ksk_wrong" })).status,
    ).toBe(403);
    expect(
      (await request("GET", `/v1/sites/site_nope/tests`, { key: WRITE_KEY })).status,
    ).toBe(404);
  });
});

describe("B2 GET /v1/tests/:id (get)", () => {
  it("returns the full test with its variants", async () => {
    await seedTest();
    const res = await request("GET", "/v1/tests/tst_base", { key: WRITE_KEY });
    expect(res.status).toBe(200);

    const test = (await res.json()) as TestResource;
    expect(test.id).toBe("tst_base");
    expect(test.siteId).toBe(SITE_ID);
    expect(test.coverage).toBe(0.5);
    expect(test.variants.map((v) => v.id)).toEqual(["control", "v1"]);
    expect(test.variants[1].changes).toEqual([
      { selector: ".cta", type: "style", value: { color: "red" } },
    ]);
  });

  it("404s an unknown test with the error envelope", async () => {
    const res = await request("GET", "/v1/tests/tst_ghost", { key: WRITE_KEY });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("test_not_found");
  });

  it("enforces auth on a real test: 401 without key, 403 wrong key", async () => {
    await seedTest();
    expect((await request("GET", "/v1/tests/tst_base")).status).toBe(401);
    const wrong = await request("GET", "/v1/tests/tst_base", { key: "ksk_wrong" });
    expect(wrong.status).toBe(403);
  });

  it("isolates sites: another site's key cannot read this test (403)", async () => {
    await seedTest();
    // Mint a second site with its own key; it must not reach site_ctrl's test.
    const otherRes = await request("POST", "/v1/sites", { body: { name: "Other" } });
    const other = (await otherRes.json()) as { writeKey: string };
    const res = await request("GET", "/v1/tests/tst_base", { key: other.writeKey });
    expect(res.status).toBe(403);
  });
});

describe("B3 PATCH /v1/tests/:id (edit)", () => {
  it("applies a partial update and leaves other fields untouched", async () => {
    await seedTest();
    const res = await request("PATCH", "/v1/tests/tst_base", {
      key: WRITE_KEY,
      body: { name: "Renamed", coverage: 0.2, conversionWindowDays: 14 },
    });
    expect(res.status).toBe(200);

    const test = (await res.json()) as TestResource;
    expect(test.name).toBe("Renamed");
    expect(test.coverage).toBe(0.2);
    expect(test.conversionWindowDays).toBe(14);
    expect(test.status).toBe("running"); // untouched
    expect(test.variants).toHaveLength(2); // untouched
  });

  it("can change status and targeting", async () => {
    await seedTest();
    const res = await request("PATCH", "/v1/tests/tst_base", {
      key: WRITE_KEY,
      body: {
        status: "stopped",
        urlMatch: { include: [{ type: "prefix", value: "https://x.com/p" }] },
      },
    });
    const test = (await res.json()) as TestResource;
    expect(test.status).toBe("stopped");
    expect(test.urlMatch).toEqual({
      include: [{ type: "prefix", value: "https://x.com/p" }],
    });
  });

  it("purges the delivery cache so the edit is reflected", async () => {
    await seedTest();
    // Warm the cache, then edit coverage.
    await deliveredConfig();
    expect((await deliveredConfig()).tests[0].coverage).toBe(0.5);

    await request("PATCH", "/v1/tests/tst_base", {
      key: WRITE_KEY,
      body: { coverage: 0.9 },
    });
    expect((await deliveredConfig()).tests[0].coverage).toBe(0.9);
  });

  it("rejects an empty patch with 400 invalid_body", async () => {
    await seedTest();
    const res = await request("PATCH", "/v1/tests/tst_base", { key: WRITE_KEY, body: {} });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("rejects an out-of-range coverage with 400", async () => {
    await seedTest();
    const res = await request("PATCH", "/v1/tests/tst_base", {
      key: WRITE_KEY,
      body: { coverage: 2 },
    });
    expect(res.status).toBe(400);
  });

  it("404s an unknown test", async () => {
    const res = await request("PATCH", "/v1/tests/tst_ghost", {
      key: WRITE_KEY,
      body: { name: "x" },
    });
    expect(res.status).toBe(404);
  });
});

describe("B4 PUT /v1/tests/:id/variants (replace)", () => {
  it("replaces the entire variant set", async () => {
    await seedTest();
    const res = await request("PUT", "/v1/tests/tst_base/variants", {
      key: WRITE_KEY,
      body: {
        variants: [
          { id: "a", weight: 2 },
          { id: "b", weight: 3, changes: [{ selector: "#h", type: "text", value: "Hi" }] },
          { id: "c", weight: 1 },
        ],
      },
    });
    expect(res.status).toBe(200);

    const test = (await res.json()) as TestResource;
    expect(test.variants.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(test.variants[1].changes).toEqual([
      { selector: "#h", type: "text", value: "Hi" },
    ]);

    // Old variants are gone, not merged.
    const { results } = await env.DB.prepare(
      "SELECT id FROM variant WHERE test_id = ? ORDER BY position ASC",
    )
      .bind("tst_base")
      .all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("purges the delivery cache so the new variants ship", async () => {
    await seedTest();
    await deliveredConfig(); // warm
    await request("PUT", "/v1/tests/tst_base/variants", {
      key: WRITE_KEY,
      body: { variants: [{ id: "solo", weight: 1 }] },
    });
    expect((await deliveredConfig()).tests[0].variants.map((v) => v.id)).toEqual(["solo"]);
  });

  it("rejects duplicate variant ids with 400", async () => {
    await seedTest();
    const res = await request("PUT", "/v1/tests/tst_base/variants", {
      key: WRITE_KEY,
      body: {
        variants: [
          { id: "x", weight: 1 },
          { id: "x", weight: 1 },
        ],
      },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("rejects an empty variant set with 400", async () => {
    await seedTest();
    const res = await request("PUT", "/v1/tests/tst_base/variants", {
      key: WRITE_KEY,
      body: { variants: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe("B5 POST /v1/tests/:id/apply (hero)", () => {
  it("sets the winner and flips status to applied", async () => {
    await seedTest();
    const res = await request("POST", "/v1/tests/tst_base/apply", {
      key: WRITE_KEY,
      body: { winner: "v1" },
    });
    expect(res.status).toBe(200);

    const test = (await res.json()) as TestResource;
    expect(test.status).toBe("applied");
    expect(test.winner).toBe("v1");
  });

  it("purges the cache so the applied winner ships", async () => {
    await seedTest();
    await deliveredConfig(); // warm
    await request("POST", "/v1/tests/tst_base/apply", {
      key: WRITE_KEY,
      body: { winner: "v1" },
    });
    const delivered = (await deliveredConfig()).tests[0];
    expect(delivered.status).toBe("applied");
    expect(delivered.winner).toBe("v1");
  });

  it("rejects a winner that is not a variant of the test (400 unknown_winner)", async () => {
    await seedTest();
    const res = await request("POST", "/v1/tests/tst_base/apply", {
      key: WRITE_KEY,
      body: { winner: "ghost" },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("unknown_winner");
  });

  it("rejects a missing winner with 400 invalid_body", async () => {
    await seedTest();
    const res = await request("POST", "/v1/tests/tst_base/apply", {
      key: WRITE_KEY,
      body: {},
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });
});

describe("B6 POST /v1/tests/:id/stop (kill switch)", () => {
  it("flips status to stopped", async () => {
    await seedTest();
    const res = await request("POST", "/v1/tests/tst_base/stop", { key: WRITE_KEY });
    expect(res.status).toBe(200);
    const test = (await res.json()) as TestResource;
    expect(test.status).toBe("stopped");
  });

  it("instantly purges the cache (the kill switch is reflected at once)", async () => {
    await seedTest();
    await deliveredConfig(); // warm
    expect((await deliveredConfig()).tests[0].status).toBe("running");

    await request("POST", "/v1/tests/tst_base/stop", { key: WRITE_KEY });
    expect((await deliveredConfig()).tests[0].status).toBe("stopped");
  });

  it("enforces auth and 404s an unknown test", async () => {
    await seedTest();
    expect((await request("POST", "/v1/tests/tst_base/stop")).status).toBe(401);
    expect(
      (await request("POST", "/v1/tests/tst_ghost/stop", { key: WRITE_KEY })).status,
    ).toBe(404);
  });
});
