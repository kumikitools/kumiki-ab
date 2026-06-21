import { describe, it, expect } from "vitest";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import { toToolError, toToolResult } from "../src/tool-result.js";
import type { KumikiMcpConfig } from "../src/config.js";

// Error-mapping layer (C0). Two halves both C1–C8 inherit:
//   1. ApiClient turns an HTTP response into a resource or an ApiClientError
//      that PRESERVES the API's stable `code`.
//   2. toToolError turns that into an MCP tool error whose content carries the
//      `code` (what a calling agent switches on) — never swallowed.

const config: KumikiMcpConfig = {
  apiUrl: "https://kumiki.example",
  apiKey: "ksk_test_key",
};

/** A fetch stub returning a fixed status + JSON body, capturing the request. */
function stubFetch(
  status: number,
  body: unknown,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("ApiClient request", () => {
  it("returns parsed JSON and attaches the bearer key on success", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = new ApiClient(
      config,
      stubFetch(201, { id: "tst_1", status: "running" }, (u, i) => {
        seenUrl = u;
        seenInit = i;
      }),
    );

    const resource = await client.post("/v1/sites/site_1/tests", { name: "T" });

    expect(resource).toEqual({ id: "tst_1", status: "running" });
    expect(seenUrl).toBe("https://kumiki.example/v1/sites/site_1/tests");
    expect((seenInit.headers as Record<string, string>).authorization).toBe(
      "Bearer ksk_test_key",
    );
    expect(seenInit.body).toBe(JSON.stringify({ name: "T" }));
  });

  it("preserves the API's stable code from the error envelope", async () => {
    const client = new ApiClient(
      config,
      stubFetch(404, {
        error: { code: "site_not_found", message: "No site with id 'x'" },
      }),
    );

    await expect(client.get("/v1/sites/x/tests")).rejects.toMatchObject({
      code: "site_not_found",
      status: 404,
    });
  });

  it("carries envelope details through (e.g. zod issues on invalid_body)", async () => {
    const details = { fieldErrors: { name: ["Required"] } };
    const client = new ApiClient(
      config,
      stubFetch(400, {
        error: { code: "invalid_body", message: "failed", details },
      }),
    );

    try {
      await client.post("/v1/sites/s/tests", {});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).code).toBe("invalid_body");
      expect((err as ApiClientError).details).toEqual(details);
    }
  });

  it("maps a non-2xx without an envelope to unexpected_error", async () => {
    const client = new ApiClient(config, stubFetch(502, "<html>bad gateway</html>"));
    await expect(client.get("/v1/sites/s/tests")).rejects.toMatchObject({
      code: "unexpected_error",
      status: 502,
    });
  });

  it("maps a transport failure to network_error (status 0)", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = new ApiClient(config, failing);

    await expect(client.get("/v1/sites/s/tests")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });
});

describe("toToolResult / toToolError", () => {
  it("wraps a resource as non-error JSON content", () => {
    const result = toToolResult({ id: "tst_1" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "tst_1",
    });
  });

  it("surfaces an ApiClientError's code in the tool error content", () => {
    const result = toToolError(
      new ApiClientError(400, "unknown_winner", "winner 'z' is not a variant"),
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("unknown_winner");
    expect(payload.error.message).toContain("winner");
  });

  it("falls back to unexpected_error for a non-ApiClientError throw", () => {
    const result = toToolError(new Error("boom"));
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(true);
    expect(payload.error.code).toBe("unexpected_error");
    expect(payload.error.message).toBe("boom");
  });
});
