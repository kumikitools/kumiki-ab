import { describe, it, expect } from "vitest";
import { stopTestHandler } from "../src/tools/stop-test.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { StopTestArgs } from "../src/tools/stop-test.js";

// C6 handler, exercised against a fake ApiClient (mirrors create-test.test.ts):
// it strips the `testId` path param into the URL and — since /stop takes no body
// — calls post with no body, then routes success vs. API failure through the
// shared mappers, preserving the API's `code` (notably 404 test_not_found).

/** A stand-in ApiClient that records the call and returns a canned outcome. */
function fakeClient(outcome: { resolve?: unknown; reject?: unknown }): {
  client: ApiClient;
  calls: { path: string; body: unknown }[];
} {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    post(path: string, body: unknown) {
      calls.push({ path, body });
      if (outcome.reject) return Promise.reject(outcome.reject);
      return Promise.resolve(outcome.resolve);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const args: StopTestArgs = {
  testId: "tst_base",
};

describe("stopTestHandler", () => {
  it("posts to the test's stop route with no body (testId in the path)", async () => {
    const { client, calls } = fakeClient({
      resolve: { id: "tst_base", status: "stopped" },
    });
    const result = await stopTestHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/tests/tst_base/stop");
    expect(calls[0].body).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "tst_base",
      status: "stopped",
    });
  });

  it("url-encodes the test id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await stopTestHandler(client)({ testId: "tst/odd id" });
    expect(calls[0].path).toBe("/v1/tests/tst%2Fodd%20id/stop");
  });

  it("maps 404 test_not_found to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "test_not_found", "No test with id 'x'"),
    });
    const result = await stopTestHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("test_not_found");
  });

  it("maps an auth failure (invalid_key) preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(401, "invalid_key", "Unknown write key"),
    });
    const result = await stopTestHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("invalid_key");
  });
});

describe("stopTestArgs", () => {
  it("requires testId", async () => {
    const { z } = await import("zod");
    const { stopTestArgs } = await import("../src/tools/stop-test.js");
    const schema = z.object(stopTestArgs);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ testId: "tst_1" }).success).toBe(true);
  });
});
