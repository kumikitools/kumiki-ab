import { describe, it, expect } from "vitest";
import { getResultsHandler } from "../src/tools/get-results.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { GetResultsArgs } from "../src/tools/get-results.js";

// The C8 read tool's handler, exercised against a fake ApiClient (mirror of
// create-test.test.ts). A GET replica has no body to strip, so the two things we
// assert are: it puts the testId into the results route (url-encoded), and it
// routes success vs. API failure through the shared result mappers, preserving
// the API's `code`.

/** A stand-in ApiClient that records the GET path and returns a canned outcome. */
function fakeClient(outcome: { resolve?: unknown; reject?: unknown }): {
  client: ApiClient;
  calls: { path: string }[];
} {
  const calls: { path: string }[] = [];
  const client = {
    get(path: string) {
      calls.push({ path });
      if (outcome.reject) return Promise.reject(outcome.reject);
      return Promise.resolve(outcome.resolve);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const args: GetResultsArgs = { testId: "tst_1" };

const results = {
  testId: "tst_1",
  windowDays: 7,
  variants: [
    { id: "control", exposed: 100, converted: 10, rate: 0.1, pBest: 0.3, ci95: [0.05, 0.17] },
    { id: "v1", exposed: 100, converted: 18, rate: 0.18, pBest: 0.7, ci95: [0.11, 0.26] },
  ],
  winner: "v1",
};

describe("getResultsHandler", () => {
  it("gets the test's results route and returns the JSON results", async () => {
    const { client, calls } = fakeClient({ resolve: results });
    const result = await getResultsHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/tests/tst_1/results");

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(results);
  });

  it("url-encodes the test id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await getResultsHandler(client)({ testId: "tst/odd id" });
    expect(calls[0].path).toBe("/v1/tests/tst%2Fodd%20id/results");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "test_not_found", "No test with id 'x'"),
    });
    const result = await getResultsHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("test_not_found");
  });

  it("preserves an auth failure code (invalid_key)", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(403, "invalid_key", "Write key is not valid for this site"),
    });
    const result = await getResultsHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("invalid_key");
  });
});
