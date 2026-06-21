import { describe, it, expect } from "vitest";
import { applyWinnerHandler } from "../src/tools/apply-winner.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { ApplyWinnerArgs } from "../src/tools/apply-winner.js";

// C5 handler, exercised against a fake ApiClient (mirrors create-test.test.ts):
// it strips the `testId` path param into the URL and sends the rest (`winner`)
// as the body, and routes success vs. API failure through the shared mappers —
// preserving the API's `code` (notably 400 unknown_winner).

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

const args: ApplyWinnerArgs = {
  testId: "tst_base",
  winner: "v1",
};

describe("applyWinnerHandler", () => {
  it("posts to the test's apply route with the body (testId stripped)", async () => {
    const { client, calls } = fakeClient({
      resolve: { id: "tst_base", status: "applied", winner: "v1" },
    });
    const result = await applyWinnerHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/tests/tst_base/apply");
    expect(calls[0].body).toEqual({ winner: "v1" });
    expect((calls[0].body as Record<string, unknown>).testId).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "tst_base",
      status: "applied",
      winner: "v1",
    });
  });

  it("url-encodes the test id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await applyWinnerHandler(client)({ ...args, testId: "tst/odd id" });
    expect(calls[0].path).toBe("/v1/tests/tst%2Fodd%20id/apply");
  });

  it("surfaces 400 unknown_winner as a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(
        400,
        "unknown_winner",
        "winner 'ghost' is not a variant of test 'tst_base'",
      ),
    });
    const result = await applyWinnerHandler(client)({ ...args, winner: "ghost" });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("unknown_winner");
  });

  it("surfaces 404 test_not_found preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "test_not_found", "No test with id 'x'"),
    });
    const result = await applyWinnerHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("test_not_found");
  });
});
