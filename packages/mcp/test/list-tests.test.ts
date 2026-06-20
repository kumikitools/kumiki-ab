import { describe, it, expect } from "vitest";
import { listTestsHandler } from "../src/tools/list-tests.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { ListTestsArgs } from "../src/tools/list-tests.js";

// The C1 list handler, exercised against a fake ApiClient so we assert the two
// things a replica must get right: it GETs the site's tests route (siteId in the
// path, no body), and it routes success vs. API failure through the shared
// result mappers — mirrors create-test.test.ts (C0).

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

const args: ListTestsArgs = { siteId: "site_abc" };

describe("listTestsHandler", () => {
  it("gets the site's tests route and returns the resource", async () => {
    const tests = [{ id: "tst_1" }, { id: "tst_2" }];
    const { client, calls } = fakeClient({ resolve: tests });
    const result = await listTestsHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/sites/site_abc/tests");

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(
      tests,
    );
  });

  it("url-encodes the site id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: [] });
    await listTestsHandler(client)({ siteId: "site/odd id" });
    expect(calls[0].path).toBe("/v1/sites/site%2Fodd%20id/tests");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "site_not_found", "No site with id 'x'"),
    });
    const result = await listTestsHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("site_not_found");
  });
});
