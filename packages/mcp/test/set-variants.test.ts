import { describe, it, expect } from "vitest";
import { setVariantsHandler } from "../src/tools/set-variants.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { SetVariantsArgs } from "../src/tools/set-variants.js";

// The C4 tool's handler, exercised against a fake ApiClient — the same two
// things every replica (C1–C8) must get right: it strips the path param
// (`testId`) into the URL and sends the rest as the PUT body, and it routes
// success vs. API failure through the shared result mappers.

/** A stand-in ApiClient that records the call and returns a canned outcome. */
function fakeClient(outcome: { resolve?: unknown; reject?: unknown }): {
  client: ApiClient;
  calls: { path: string; body: unknown }[];
} {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    put(path: string, body: unknown) {
      calls.push({ path, body });
      if (outcome.reject) return Promise.reject(outcome.reject);
      return Promise.resolve(outcome.resolve);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const args: SetVariantsArgs = {
  testId: "tst_1",
  variants: [
    { id: "control", weight: 1 },
    { id: "b", weight: 1, changes: [{ selector: "h1", type: "text", value: "Hi" }] },
  ],
};

describe("setVariantsHandler", () => {
  it("puts to the variants route with the body (testId stripped)", async () => {
    const { client, calls } = fakeClient({ resolve: { id: "tst_1" } });
    const result = await setVariantsHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/tests/tst_1/variants");
    expect(calls[0].body).toEqual({ variants: args.variants });
    expect((calls[0].body as Record<string, unknown>).testId).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "tst_1",
    });
  });

  it("url-encodes the test id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await setVariantsHandler(client)({ ...args, testId: "tst/odd id" });
    expect(calls[0].path).toBe("/v1/tests/tst%2Fodd%20id/variants");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "test_not_found", "No test with id 'x'"),
    });
    const result = await setVariantsHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("test_not_found");
  });

  it("surfaces the API's invalid_body for a duplicate-id set", async () => {
    // The "ids must be unique" rule lives in the API; the handler just forwards
    // the body and surfaces invalid_body — it does not re-implement it.
    const { client, calls } = fakeClient({
      reject: new ApiClientError(400, "invalid_body", "variant ids must be unique"),
    });
    const dupes = [
      { id: "x", weight: 1 },
      { id: "x", weight: 1 },
    ];
    const result = await setVariantsHandler(client)({ testId: "tst_1", variants: dupes });

    expect(calls[0].body).toEqual({ variants: dupes });
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("invalid_body");
  });
});
