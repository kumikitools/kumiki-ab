import { describe, it, expect } from "vitest";
import { getGoalsHandler } from "../src/tools/get-goals.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { GetGoalsArgs } from "../src/tools/get-goals.js";

// Handler exercised against a fake ApiClient — the two things a GET replica
// must get right: GETs the site goals route (siteId in path, no body), and
// routes success vs. API failure through the shared result mappers.

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

const args: GetGoalsArgs = { siteId: "site_abc" };

describe("getGoalsHandler", () => {
  it("gets the site goals route and returns the resource", async () => {
    const goals = [{ id: "g1", type: "click", selector: ".btn" }];
    const { client, calls } = fakeClient({ resolve: { goals } });
    const result = await getGoalsHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/sites/site_abc/goals");

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ goals });
  });

  it("url-encodes the site id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: { goals: [] } });
    await getGoalsHandler(client)({ siteId: "site/odd id" });
    expect(calls[0].path).toBe("/v1/sites/site%2Fodd%20id/goals");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "site_not_found", "No site with id 'x'"),
    });
    const result = await getGoalsHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("site_not_found");
  });
});
