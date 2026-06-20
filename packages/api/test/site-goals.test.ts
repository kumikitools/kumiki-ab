import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";

// TASK-21 — goal authoring: GET + PUT /v1/sites/:id/goals and delivery propagation.
// Each test run gets a fresh D1 (migrations applied in apply-migrations.ts).
const SITE_ID = "site_goals";
const WRITE_KEY = "ksk_goalskey_abcdef0123456789";

async function seedSite(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO site (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(SITE_ID, "Goals Site", await sha256Hex(WRITE_KEY), 1_700_000_000_000)
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

beforeEach(seedSite);

const urlGoal = {
  id: "g_purchase",
  type: "url" as const,
  targeting: { include: [{ type: "contains" as const, value: "/thank-you" }] },
};
const clickGoal = {
  id: "g_cta",
  type: "click" as const,
  selector: ".buy-btn",
};
const formGoal = {
  id: "g_lead",
  type: "form" as const,
  selector: "#contact-form",
  value: 500,
};

describe("GET /v1/sites/:id/goals", () => {
  it("returns empty goals for a fresh site", async () => {
    const res = await request("GET", `/v1/sites/${SITE_ID}/goals`, { key: WRITE_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goals: [] });
  });

  it("enforces auth: 401 without key, 403 wrong key, 404 unknown site", async () => {
    expect((await request("GET", `/v1/sites/${SITE_ID}/goals`)).status).toBe(401);
    expect(
      (await request("GET", `/v1/sites/${SITE_ID}/goals`, { key: "ksk_wrong" })).status,
    ).toBe(403);
    expect(
      (await request("GET", `/v1/sites/site_nope/goals`, { key: WRITE_KEY })).status,
    ).toBe(404);
  });
});

describe("PUT /v1/sites/:id/goals", () => {
  it("stores and returns a mixed url/click/form set", async () => {
    const goals = [urlGoal, clickGoal, formGoal];
    const res = await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goals });
  });

  it("GET returns the stored set after a PUT", async () => {
    const goals = [urlGoal, clickGoal];
    await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals },
    });
    const res = await request("GET", `/v1/sites/${SITE_ID}/goals`, { key: WRITE_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goals });
  });

  it("replaces the full set on a second PUT", async () => {
    await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals: [urlGoal, clickGoal] },
    });
    const res = await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals: [formGoal] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { goals: { id: string }[] };
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0].id).toBe("g_lead");
  });

  it("400 invalid_body on duplicate goal ids", async () => {
    const res = await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals: [urlGoal, { ...urlGoal }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("invalid_body");
  });

  it("400 invalid_body on malformed goal (url goal missing targeting)", async () => {
    const res = await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals: [{ id: "g1", type: "url" }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("invalid_body");
  });

  it("enforces auth: 401 without key, 403 wrong key, 404 unknown site", async () => {
    const body = { goals: [] };
    expect((await request("PUT", `/v1/sites/${SITE_ID}/goals`, { body })).status).toBe(401);
    expect(
      (await request("PUT", `/v1/sites/${SITE_ID}/goals`, { key: "ksk_wrong", body })).status,
    ).toBe(403);
    expect(
      (await request("PUT", `/v1/sites/site_nope/goals`, { key: WRITE_KEY, body })).status,
    ).toBe(404);
  });
});

describe("delivery — goals propagated to /v1/config and /s.js", () => {
  it("GET /v1/config/:siteId includes stored goals after a PUT", async () => {
    await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals: [clickGoal] },
    });
    const res = await app.request(`/v1/config/${SITE_ID}`, {}, env);
    expect(res.status).toBe(200);
    const config = (await res.json()) as { goals: unknown[] };
    expect(config.goals).toEqual([clickGoal]);
  });

  it("GET /s.js bakes stored goals into the config", async () => {
    await request("PUT", `/v1/sites/${SITE_ID}/goals`, {
      key: WRITE_KEY,
      body: { goals: [urlGoal] },
    });
    const res = await app.request(`/s.js?site=${SITE_ID}`, {}, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"g_purchase"');
  });

  it("GET /v1/config includes empty goals for a fresh site", async () => {
    const res = await app.request(`/v1/config/${SITE_ID}`, {}, env);
    expect(res.status).toBe(200);
    const config = (await res.json()) as { goals: unknown[] };
    expect(config.goals).toEqual([]);
  });
});
