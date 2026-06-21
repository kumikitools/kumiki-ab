import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import app from "../src/index";
import { sha256Hex } from "../src/crypto";
import { signPayload, MAX_ATTEMPTS, BATCH_LIMIT } from "../src/webhook";
import { deleteWebhookDelivery } from "../src/db";
import { drainWebhooks } from "../src/webhook";

// D4 webhook tests: control routes (GET/PUT/DELETE /v1/sites/:id/webhook),
// ingest outbox wiring, and drain behaviour (all with stubbed global fetch).

const SITE_ID = "site_wh";
const WRITE_KEY = "ksk_webhook_test_key_fixture";

async function seedSite(
  overrides: {
    webhook_url?: string;
    webhook_secret?: string;
    webhook_enabled?: number;
    webhook_events?: string;
  } = {},
): Promise<void> {
  const hash = await sha256Hex(WRITE_KEY);
  const cols = ["id", "name", "api_key_hash", "created_at"];
  const vals: unknown[] = [SITE_ID, "Webhook Site", hash, 1_700_000_000_000];

  if (overrides.webhook_url !== undefined) {
    cols.push("webhook_url");
    vals.push(overrides.webhook_url);
  }
  if (overrides.webhook_secret !== undefined) {
    cols.push("webhook_secret");
    vals.push(overrides.webhook_secret);
  }
  if (overrides.webhook_enabled !== undefined) {
    cols.push("webhook_enabled");
    vals.push(overrides.webhook_enabled);
  }
  if (overrides.webhook_events !== undefined) {
    cols.push("webhook_events");
    vals.push(overrides.webhook_events);
  }

  await env.DB.prepare(
    `INSERT INTO site (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  )
    .bind(...vals)
    .run();
}

function auth() {
  return { Authorization: `Bearer ${WRITE_KEY}` };
}

function request(method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        method,
        headers: { "content-type": "application/json", ...auth() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    ),
  );
}

const exposure = (key = "exp_1") => ({
  type: "exposure" as const,
  key,
  ts: 1_700_000_001_000,
  visitorId: "vis_a",
  testId: "tst_x",
  variantId: "v1",
});

const conversion = (key = "conv_1") => ({
  type: "conversion" as const,
  key,
  ts: 1_700_000_002_000,
  visitorId: "vis_a",
  goal: "purchase",
});

async function countOutbox(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM webhook_delivery WHERE site_id = ?",
  )
    .bind(SITE_ID)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function seedDelivery(overrides: {
  id?: string;
  attempts?: number;
  next_attempt_at?: number;
  webhook_url?: string;
  webhook_secret?: string;
}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO webhook_delivery (id, site_id, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      SITE_ID,
      JSON.stringify({ siteId: SITE_ID, deliveryId: id, events: [exposure()] }),
      overrides.attempts ?? 0,
      overrides.next_attempt_at ?? now,
      now,
    )
    .run();
  return id;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── GET /v1/sites/:id/webhook ───────────────────────────────────────────────

describe("D4 GET /v1/sites/:id/webhook", () => {
  it("returns webhook config without the secret", async () => {
    await seedSite({
      webhook_url: "https://example.com/hook",
      webhook_secret: "super_secret_value",
      webhook_enabled: 1,
      webhook_events: "all",
    });

    const res = await request("GET", `/v1/sites/${SITE_ID}/webhook`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.url).toBe("https://example.com/hook");
    expect(json.enabled).toBe(true);
    expect(json.events).toBe("all");
    expect(json.secret).toBeUndefined();
  });

  it("returns 404 when no webhook is configured", async () => {
    await seedSite();
    const res = await request("GET", `/v1/sites/${SITE_ID}/webhook`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("webhook_not_found");
  });

  it("returns 401 with no auth", async () => {
    await seedSite({ webhook_url: "https://example.com/hook" });
    const res = await app.request(`/v1/sites/${SITE_ID}/webhook`, { method: "GET" }, env);
    expect(res.status).toBe(401);
  });
});

// ─── PUT /v1/sites/:id/webhook ───────────────────────────────────────────────

describe("D4 PUT /v1/sites/:id/webhook", () => {
  it("sets url, events, enabled on first call", async () => {
    await seedSite();
    const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, {
      url: "https://hooks.example.com/kumiki",
      events: "all",
      enabled: true,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.url).toBe("https://hooks.example.com/kumiki");
    expect(json.enabled).toBe(true);
    expect(json.events).toBe("all");
  });

  it("generates and returns secret once when omitted on first set", async () => {
    await seedSite();
    const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, {
      url: "https://hooks.example.com/kumiki",
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(typeof json.secret).toBe("string");
    expect((json.secret as string).length).toBeGreaterThan(16);

    // Second PUT without a secret keeps the stored one, does NOT return it.
    const res2 = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, {
      url: "https://hooks.example.com/kumiki",
    });
    const json2 = (await res2.json()) as Record<string, unknown>;
    expect(json2.secret).toBeUndefined();
  });

  it("uses caller-provided secret and does not return it", async () => {
    await seedSite();
    const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, {
      url: "https://hooks.example.com/kumiki",
      secret: "my_own_secret_value_123",
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.secret).toBeUndefined();
  });

  it("rejects non-https url with 400 invalid_body", async () => {
    await seedSite();
    const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, {
      url: "http://hooks.example.com/kumiki",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("rejects localhost with 400 invalid_body", async () => {
    await seedSite();
    const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, {
      url: "https://localhost/hook",
    });
    expect(res.status).toBe(400);
  });

  it("rejects RFC1918 addresses with 400 invalid_body", async () => {
    await seedSite();
    for (const url of [
      "https://10.0.0.1/hook",
      "https://192.168.1.1/hook",
      "https://172.16.0.1/hook",
      "https://169.254.169.254/hook",
    ]) {
      const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, { url });
      expect(res.status, `expected 400 for ${url}`).toBe(400);
    }
  });

  it("rejects .internal and .local hostnames with 400 invalid_body", async () => {
    await seedSite();
    for (const url of [
      "https://api.cluster.internal/hook",
      "https://myservice.local/hook",
    ]) {
      const res = await request("PUT", `/v1/sites/${SITE_ID}/webhook`, { url });
      expect(res.status, `expected 400 for ${url}`).toBe(400);
    }
  });

  it("returns 403 with wrong auth", async () => {
    await seedSite();
    const res = await app.request(
      `/v1/sites/${SITE_ID}/webhook`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer ksk_wrong_key",
        },
        body: JSON.stringify({ url: "https://hooks.example.com/kumiki" }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /v1/sites/:id/webhook ────────────────────────────────────────────

describe("D4 DELETE /v1/sites/:id/webhook", () => {
  it("disables the webhook", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "some_secret_value_1234",
      webhook_enabled: 1,
    });

    const res = await request("DELETE", `/v1/sites/${SITE_ID}/webhook`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { enabled: boolean };
    expect(json.enabled).toBe(false);

    // Verify the DB was updated.
    const row = await env.DB.prepare("SELECT webhook_enabled FROM site WHERE id = ?")
      .bind(SITE_ID)
      .first<{ webhook_enabled: number }>();
    expect(row?.webhook_enabled).toBe(0);
  });

  it("returns 404 when no webhook is configured", async () => {
    await seedSite();
    const res = await request("DELETE", `/v1/sites/${SITE_ID}/webhook`);
    expect(res.status).toBe(404);
  });
});

// ─── Ingest outbox wiring ─────────────────────────────────────────────────────

describe("D4 ingest outbox wiring", () => {
  async function beacon(siteId: string, body: unknown, envOverride = env): Promise<Response> {
    return Promise.resolve(
      app.request(
        `/v1/e/${siteId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        envOverride,
      ),
    );
  }

  it("writes one outbox row per beacon when webhook is enabled (scope=all)", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
      webhook_events: "all",
    });

    const res = await beacon(SITE_ID, { events: [exposure(), conversion()] });
    expect(res.status).toBe(202);
    expect(await countOutbox()).toBe(1);

    const row = await env.DB.prepare(
      "SELECT payload FROM webhook_delivery WHERE site_id = ?",
    )
      .bind(SITE_ID)
      .first<{ payload: string }>();
    const payload = JSON.parse(row!.payload) as { events: unknown[] };
    expect(payload.events).toHaveLength(2);
  });

  it("scope=conversions: outbox has only conversions; exposure-only batch → no row", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
      webhook_events: "conversions",
    });

    // Exposure-only batch → no outbox row.
    await beacon(SITE_ID, { events: [exposure()] });
    expect(await countOutbox()).toBe(0);

    // Mixed batch → outbox row contains only the conversion.
    await beacon(SITE_ID, {
      events: [exposure("exp_2"), conversion("conv_2")],
    });
    expect(await countOutbox()).toBe(1);

    const row = await env.DB.prepare(
      "SELECT payload FROM webhook_delivery WHERE site_id = ?",
    )
      .bind(SITE_ID)
      .first<{ payload: string }>();
    const payload = JSON.parse(row!.payload) as {
      events: Array<{ type: string }>;
    };
    expect(payload.events.every((e) => e.type === "conversion")).toBe(true);
  });

  it("writes NO outbox row when webhook is disabled", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 0,
    });

    await beacon(SITE_ID, { events: [exposure(), conversion()] });
    expect(await countOutbox()).toBe(0);
  });

  it("fail-open: forced batch failure drops events AND outbox row (still 202)", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
    });

    const failingDb = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: () => Promise.reject(new Error("simulated D1 write ceiling")),
    } as unknown as D1Database;

    const res = await beacon(SITE_ID, { events: [exposure()] }, { DB: failingDb } as typeof env);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 0, dropped: 1 });
    // No outbox row (whole batch was rolled back).
    expect(await countOutbox()).toBe(0);
  });
});

// ─── drainWebhooks — delivery + retry/backoff ────────────────────────────────

describe("D4 drainWebhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers due rows: 2xx → row deleted, signature verifies", async () => {
    const secret = "drain_test_secret_xyz_1234";
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: secret,
      webhook_enabled: 1,
    });
    const id = await seedDelivery({});

    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      async (_url: unknown, init: RequestInit): Promise<Response> => {
        // Normalize header keys to lowercase (HTTP headers are case-insensitive).
        const raw = init.headers as Record<string, string>;
        capturedHeaders = Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]),
        );
        capturedBody = init.body as string;
        return new Response(null, { status: 200 });
      },
    );

    await drainWebhooks(env);

    // Row must be deleted.
    const row = await env.DB.prepare(
      "SELECT id FROM webhook_delivery WHERE id = ?",
    )
      .bind(id)
      .first();
    expect(row).toBeNull();

    // Signature must be valid.
    const expected = `sha256=${await signPayload(secret, capturedBody)}`;
    expect(capturedHeaders["x-kumiki-signature"]).toBe(expected);
    expect(capturedHeaders["x-kumiki-delivery-id"]).toBe(id);
    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  it("5xx → attempts incremented, row rescheduled with growing backoff", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
    });
    const id = await seedDelivery({ attempts: 0 });

    vi.stubGlobal(
      "fetch",
      async (): Promise<Response> => new Response(null, { status: 503 }),
    );

    const beforeAt = Date.now();
    await drainWebhooks(env);

    const row = await env.DB.prepare(
      "SELECT attempts, next_attempt_at FROM webhook_delivery WHERE id = ?",
    )
      .bind(id)
      .first<{ attempts: number; next_attempt_at: number }>();
    expect(row).not.toBeNull();
    expect(row!.attempts).toBe(1);
    expect(row!.next_attempt_at).toBeGreaterThan(beforeAt + 50_000); // ≥ ~60s
  });

  it("at MAX_ATTEMPTS → row dropped after final failure", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
    });
    const id = await seedDelivery({ attempts: MAX_ATTEMPTS - 1 });

    vi.stubGlobal(
      "fetch",
      async (): Promise<Response> => new Response(null, { status: 503 }),
    );

    await drainWebhooks(env);

    const row = await env.DB.prepare(
      "SELECT id FROM webhook_delivery WHERE id = ?",
    )
      .bind(id)
      .first();
    expect(row).toBeNull();
  });

  it("only picks due rows (next_attempt_at <= now)", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
    });

    // Future row — should NOT be delivered.
    const futureId = await seedDelivery({ next_attempt_at: Date.now() + 3_600_000 });

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (url: unknown): Promise<Response> => {
        calls.push(url as string);
        return new Response(null, { status: 200 });
      },
    );

    await drainWebhooks(env);

    expect(calls).toHaveLength(0);

    // Future row still exists.
    const row = await env.DB.prepare(
      "SELECT id FROM webhook_delivery WHERE id = ?",
    )
      .bind(futureId)
      .first();
    expect(row).not.toBeNull();

    await deleteWebhookDelivery(env.DB, futureId);
  });

  it("does not pick rows for disabled webhooks", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 0,
    });
    await seedDelivery({});

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (url: unknown): Promise<Response> => {
        calls.push(url as string);
        return new Response(null, { status: 200 });
      },
    );

    await drainWebhooks(env);
    expect(calls).toHaveLength(0);
  });

  it("processes at most BATCH_LIMIT rows per drain", async () => {
    await seedSite({
      webhook_url: "https://hooks.example.com/kumiki",
      webhook_secret: "test_secret_value_1234",
      webhook_enabled: 1,
    });

    const now = Date.now();
    for (let i = 0; i < BATCH_LIMIT + 5; i++) {
      await seedDelivery({ next_attempt_at: now - 1 });
    }

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (url: unknown): Promise<Response> => {
        calls.push(url as string);
        return new Response(null, { status: 200 });
      },
    );

    await drainWebhooks(env);
    expect(calls).toHaveLength(BATCH_LIMIT);
  });
});

// ─── isWebhookUrlSafe — unit ──────────────────────────────────────────────────

describe("isWebhookUrlSafe", async () => {
  const { isWebhookUrlSafe } = await import("../src/validation");

  it("allows public HTTPS URLs", () => {
    expect(isWebhookUrlSafe("https://hooks.example.com/path")).toBe(true);
    expect(isWebhookUrlSafe("https://api.myco.io/webhook?v=1")).toBe(true);
  });

  it("rejects HTTP", () => {
    expect(isWebhookUrlSafe("http://hooks.example.com/path")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(isWebhookUrlSafe("https://localhost/hook")).toBe(false);
  });

  it("rejects loopback / RFC1918 / link-local IPs", () => {
    expect(isWebhookUrlSafe("https://127.0.0.1/hook")).toBe(false);
    expect(isWebhookUrlSafe("https://10.1.2.3/hook")).toBe(false);
    expect(isWebhookUrlSafe("https://172.20.0.1/hook")).toBe(false);
    expect(isWebhookUrlSafe("https://192.168.0.1/hook")).toBe(false);
    expect(isWebhookUrlSafe("https://169.254.169.254/hook")).toBe(false);
  });

  it("rejects .internal and .local", () => {
    expect(isWebhookUrlSafe("https://svc.cluster.internal/hook")).toBe(false);
    expect(isWebhookUrlSafe("https://api.local/hook")).toBe(false);
  });
});
