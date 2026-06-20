import { describe, it, expect } from "vitest";
import { setWebhookHandler, type SetWebhookArgs } from "../src/tools/set-webhook.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";

// C9 kumiki_set_webhook handler — mirrors the create-test.test.ts reference:
// verify the path param is stripped into the URL, the body is correct, and
// success/failure are routed through the shared result mappers.

function fakeClient(outcome: { resolve?: unknown; reject?: unknown }): {
  client: ApiClient;
  calls: { method: string; path: string; body: unknown }[];
} {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const client = {
    put(path: string, body: unknown) {
      calls.push({ method: "PUT", path, body });
      if (outcome.reject) return Promise.reject(outcome.reject);
      return Promise.resolve(outcome.resolve);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const minArgs: SetWebhookArgs = {
  siteId: "site_abc",
  url: "https://hooks.example.com/kumiki",
};

describe("setWebhookHandler", () => {
  it("calls PUT /v1/sites/:id/webhook with the body (siteId stripped)", async () => {
    const { client, calls } = fakeClient({
      resolve: { url: "https://hooks.example.com/kumiki", events: "all", enabled: true },
    });
    const result = await setWebhookHandler(client)(minArgs);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/sites/site_abc/webhook");
    expect((calls[0].body as Record<string, unknown>).url).toBe(
      "https://hooks.example.com/kumiki",
    );
    expect((calls[0].body as Record<string, unknown>).siteId).toBeUndefined();

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      url: string;
    };
    expect(parsed.url).toBe("https://hooks.example.com/kumiki");
  });

  it("url-encodes the site id", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await setWebhookHandler(client)({ ...minArgs, siteId: "site/odd id" });
    expect(calls[0].path).toBe("/v1/sites/site%2Fodd%20id/webhook");
  });

  it("passes optional fields when provided", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await setWebhookHandler(client)({
      ...minArgs,
      events: "conversions",
      enabled: false,
      secret: "my_secret_value_12345",
    });
    expect((calls[0].body as Record<string, unknown>).events).toBe("conversions");
    expect((calls[0].body as Record<string, unknown>).enabled).toBe(false);
    expect((calls[0].body as Record<string, unknown>).secret).toBe(
      "my_secret_value_12345",
    );
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(
        400,
        "invalid_body",
        "url must be https://…",
        { fieldErrors: { url: ["url must be https://…"] } },
      ),
    });
    const result = await setWebhookHandler(client)(minArgs);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(
      (result.content[0] as { text: string }).text,
    ) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid_body");
  });

  it("maps site_not_found to a tool error", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "site_not_found", "No site"),
    });
    const result = await setWebhookHandler(client)(minArgs);
    expect(result.isError).toBe(true);
    const payload = JSON.parse(
      (result.content[0] as { text: string }).text,
    ) as { error: { code: string } };
    expect(payload.error.code).toBe("site_not_found");
  });
});
