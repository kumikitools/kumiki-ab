import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";
import { SNIPPET_JS } from "../src/snippet-asset";
import type { KumikiConfig } from "@kumikitools/schema";

// Isolated D1 per run (see apply-migrations.ts); re-seed the site each test.
const SITE_ID = "site_delivery";
const WRITE_KEY = "ksk_deliverykey_0123456789";

async function seedSite(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(SITE_ID, "Delivery Site", await sha256Hex(WRITE_KEY), 1_700_000_000_000)
    .run();
}

function get(path: string): Promise<Response> {
  return Promise.resolve(app.request(path, { method: "GET" }, env));
}

async function createTest(body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(
      `/v1/sites/${SITE_ID}/tests`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${WRITE_KEY}`,
        },
        body: JSON.stringify(body),
      },
      env,
    ),
  );
}

const heroTest = {
  id: "hero",
  name: "Hero headline",
  status: "running",
  coverage: 0.5,
  conversionWindowDays: 14,
  urlMatch: { include: [{ type: "prefix", value: "https://x.com/" }] },
  variants: [
    { id: "control", weight: 1 },
    {
      id: "v1",
      weight: 1,
      changes: [{ selector: "#h", type: "text", value: "B" }],
    },
  ],
};

beforeEach(seedSite);

describe("GET /v1/config/:siteId", () => {
  it("flattens tests into the bare KumikiConfig contract (no control fields)", async () => {
    await createTest(heroTest);

    const res = await get(`/v1/config/${SITE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const config = (await res.json()) as KumikiConfig;
    expect(config.tests).toHaveLength(1);
    const test = config.tests[0];

    // Exactly the contract Test — no siteId/name/conversionWindowDays/timestamps.
    expect(test).toEqual({
      id: "hero",
      status: "running",
      coverage: 0.5,
      urlMatch: { include: [{ type: "prefix", value: "https://x.com/" }] },
      variants: [
        { id: "control", weight: 1 },
        { id: "v1", weight: 1, changes: [{ selector: "#h", type: "text", value: "B" }] },
      ],
    });
    expect(test).not.toHaveProperty("siteId");
    expect(test).not.toHaveProperty("name");
    expect(test).not.toHaveProperty("conversionWindowDays");
    expect(test).not.toHaveProperty("createdAt");
  });

  it("returns { tests: [] } for a site with no tests", async () => {
    const res = await get(`/v1/config/${SITE_ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tests: [] });
  });

  it("preserves test creation order and variant position", async () => {
    await createTest({ ...heroTest, id: "first" });
    await createTest({ ...heroTest, id: "second" });

    const config = (await (await get(`/v1/config/${SITE_ID}`)).json()) as KumikiConfig;
    expect(config.tests.map((t) => t.id)).toEqual(["first", "second"]);
    expect(config.tests[0].variants.map((v) => v.id)).toEqual(["control", "v1"]);
  });

  it("404s an unknown site with the error envelope", async () => {
    const res = await get("/v1/config/site_nope");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("site_not_found");
  });

  it("is CDN-cacheable and reports hit/miss", async () => {
    await createTest(heroTest);

    const miss = await get(`/v1/config/${SITE_ID}`);
    expect(miss.headers.get("cache-control")).toContain("max-age");
    expect(miss.headers.get("x-kumiki-cache")).toBe("miss");

    const hit = await get(`/v1/config/${SITE_ID}`);
    expect(hit.headers.get("x-kumiki-cache")).toBe("hit");
  });

  it("purges the cache on a config write", async () => {
    await createTest({ ...heroTest, id: "first" });

    // Warm the cache.
    expect((await get(`/v1/config/${SITE_ID}`)).headers.get("x-kumiki-cache")).toBe("miss");
    expect((await get(`/v1/config/${SITE_ID}`)).headers.get("x-kumiki-cache")).toBe("hit");

    // A new test write purges → next read is a miss and reflects the new test.
    await createTest({ ...heroTest, id: "second" });
    const after = await get(`/v1/config/${SITE_ID}`);
    expect(after.headers.get("x-kumiki-cache")).toBe("miss");
    const config = (await after.json()) as KumikiConfig;
    expect(config.tests.map((t) => t.id)).toEqual(["first", "second"]);
  });
});

describe("GET /s.js?site=:siteId", () => {
  it("returns the snippet JS with the config baked in", async () => {
    await createTest(heroTest);

    const res = await get(`/s.js?site=${SITE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("cache-control")).toContain("max-age");

    const body = await res.text();
    // Config assignment precedes the snippet bundle, and the bundle is the exact
    // independently-tested snippet (so it applies variants by construction).
    expect(body).toContain("window.KUMIKI_CONFIG=");
    expect(body).toContain('"id":"hero"');
    expect(body).toContain('"selector":"#h"');
    expect(body.endsWith(SNIPPET_JS)).toBe(true);

    // The baked config round-trips back to the delivered KumikiConfig.
    const json = body.slice(
      "window.KUMIKI_CONFIG=".length,
      body.indexOf(";\n"),
    );
    const config = JSON.parse(json) as KumikiConfig;
    expect(config.tests[0].id).toBe("hero");
  });

  it("serves an empty-config snippet for a site with no tests", async () => {
    const body = await (await get(`/s.js?site=${SITE_ID}`)).text();
    expect(body).toContain("window.KUMIKI_CONFIG={\"tests\":[]};");
    expect(body.endsWith(SNIPPET_JS)).toBe(true);
  });

  it("400s when ?site is missing", async () => {
    const res = await get("/s.js");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("missing_site");
  });

  it("404s an unknown site", async () => {
    const res = await get("/s.js?site=site_nope");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("site_not_found");
  });

  it("is cached and purged on write", async () => {
    await createTest({ ...heroTest, id: "first" });

    expect((await get(`/s.js?site=${SITE_ID}`)).headers.get("x-kumiki-cache")).toBe("miss");
    expect((await get(`/s.js?site=${SITE_ID}`)).headers.get("x-kumiki-cache")).toBe("hit");

    await createTest({ ...heroTest, id: "second" });
    const after = await get(`/s.js?site=${SITE_ID}`);
    expect(after.headers.get("x-kumiki-cache")).toBe("miss");
    expect(await after.text()).toContain('"id":"second"');
  });
});
