import { describe, it, expect } from "vitest";
import { getTestHandler } from "../src/tools/get-test.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { GetTestArgs } from "../src/tools/get-test.js";

// The C2 get handler, exercised against a fake ApiClient so we assert the two
// things a replica must get right: it GETs the test-by-id route (testId in the
// path, no body), and it routes success vs. API failure through the shared
// result mappers — mirrors list-tests.test.ts (C1) / create-test.test.ts (C0).

/** A stand-in ApiClient that records the GET call and returns a canned outcome. */
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

const args: GetTestArgs = { testId: "tst_base" };

describe("getTestHandler", () => {
  it("gets the test-by-id route and returns the resource", async () => {
    const test = { id: "tst_base", variants: [{ id: "control", weight: 1 }] };
    const { client, calls } = fakeClient({ resolve: test });
    const result = await getTestHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/tests/tst_base");

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
      test,
    );
  });

  it("url-encodes the test id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await getTestHandler(client)({ testId: "tst/odd id" });
    expect(calls[0].path).toBe("/v1/tests/tst%2Fodd%20id");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "test_not_found", "No test with id 'x'"),
    });
    const result = await getTestHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("test_not_found");
  });
});
