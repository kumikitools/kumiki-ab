import { describe, expect, it, vi } from "vitest";
import { ApiClientError, KumikiApiClient } from "./api";
import type { DashboardConfig } from "./env";

const config: DashboardConfig = {
  apiUrl: "https://api.test",
  apiKey: "wk_secret",
  siteId: "site_1",
};

/** A fetch stub returning a canned Response. */
function stubFetch(status: number, body: unknown): typeof fetch {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn(async () =>
    new Response(text, { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("KumikiApiClient", () => {
  it("attaches the bearer key and targets the site path on listTests", async () => {
    const fetchImpl = stubFetch(200, []);
    const client = new KumikiApiClient(config, fetchImpl);
    await client.listTests();

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.test/v1/sites/site_1/tests");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer wk_secret",
    );
  });

  it("sends a JSON body with content-type on createTest", async () => {
    const fetchImpl = stubFetch(201, { id: "tst_1" });
    const client = new KumikiApiClient(config, fetchImpl);
    await client.createTest({ name: "t", variants: [{ id: "control", weight: 1 }] });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.test/v1/sites/site_1/tests");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string).name).toBe("t");
  });

  it("preserves the API's stable error code on a non-2xx envelope", async () => {
    const client = new KumikiApiClient(
      config,
      stubFetch(404, { error: { code: "test_not_found", message: "nope" } }),
    );
    await expect(client.getTest("tst_x")).rejects.toMatchObject({
      code: "test_not_found",
      status: 404,
    });
  });

  it("falls back to unexpected_error on a non-2xx without an envelope", async () => {
    const client = new KumikiApiClient(config, stubFetch(500, "boom"));
    await expect(client.getResults("tst_x")).rejects.toMatchObject({
      code: "unexpected_error",
      status: 500,
    });
  });

  it("maps a transport failure to network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = new KumikiApiClient(config, fetchImpl);
    const err = await client.listTests().catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe("network_error");
  });

  it("routes the test-scoped methods to /v1/tests/:id paths", async () => {
    const fetchImpl = stubFetch(200, { id: "tst_1" });
    const client = new KumikiApiClient(config, fetchImpl);
    await client.applyWinner("tst_1", "b");
    await client.stopTest("tst_1");
    await client.replaceVariants("tst_1", [{ id: "control", weight: 1 }]);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("https://api.test/v1/tests/tst_1/apply");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ winner: "b" });
    expect(calls[1][0]).toBe("https://api.test/v1/tests/tst_1/stop");
    expect(calls[2][0]).toBe("https://api.test/v1/tests/tst_1/variants");
    expect(calls[2][1].method).toBe("PUT");
  });
});
