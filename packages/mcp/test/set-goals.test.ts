import { describe, it, expect } from "vitest";
import { setGoalsHandler } from "../src/tools/set-goals.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { SetGoalsArgs } from "../src/tools/set-goals.js";

// Handler exercised against a fake ApiClient — the two things a PUT replica
// must get right: strips siteId into the URL and sends the rest as the PUT
// body, and routes success vs. API failure through the shared result mappers.

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

const args: SetGoalsArgs = {
  siteId: "site_abc",
  goals: [
    { id: "g_click", type: "click", selector: ".buy-btn" },
    { id: "g_form", type: "form", selector: "#contact-form" },
  ],
};

describe("setGoalsHandler", () => {
  it("puts to the goals route with the body (siteId stripped)", async () => {
    const { client, calls } = fakeClient({ resolve: { goals: args.goals } });
    const result = await setGoalsHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/sites/site_abc/goals");
    expect(calls[0].body).toEqual({ goals: args.goals });
    expect((calls[0].body as Record<string, unknown>).siteId).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      goals: args.goals,
    });
  });

  it("url-encodes the site id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: { goals: [] } });
    await setGoalsHandler(client)({ ...args, siteId: "site/odd id" });
    expect(calls[0].path).toBe("/v1/sites/site%2Fodd%20id/goals");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "site_not_found", "No site with id 'x'"),
    });
    const result = await setGoalsHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("site_not_found");
  });

  it("surfaces the API's invalid_body for a duplicate-id goal set", async () => {
    const { client, calls } = fakeClient({
      reject: new ApiClientError(400, "invalid_body", "goal ids must be unique"),
    });
    const dupes = [
      { id: "g1", type: "click" as const, selector: ".a" },
      { id: "g1", type: "click" as const, selector: ".b" },
    ];
    const result = await setGoalsHandler(client)({ siteId: "site_abc", goals: dupes });

    expect(calls[0].body).toEqual({ goals: dupes });
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("invalid_body");
  });
});
