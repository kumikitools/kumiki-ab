import { describe, it, expect } from "vitest";
import { createTestHandler } from "../src/tools/create-test.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { CreateTestArgs } from "../src/tools/create-test.js";

// The reference tool's handler (C0), exercised against a fake ApiClient so we
// assert the two things a replica (C1–C8) must get right: it strips the path
// param into the URL and sends the rest as the body, and it routes success vs.
// API failure through the shared result mappers.

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

const args: CreateTestArgs = {
  siteId: "site_abc",
  name: "Hero CTA",
  variants: [{ id: "control", weight: 1 }],
};

describe("createTestHandler", () => {
  it("posts to the site's tests route with the body (siteId stripped)", async () => {
    const { client, calls } = fakeClient({ resolve: { id: "tst_1" } });
    const result = await createTestHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/sites/site_abc/tests");
    expect(calls[0].body).toEqual({
      name: "Hero CTA",
      variants: [{ id: "control", weight: 1 }],
    });
    expect((calls[0].body as Record<string, unknown>).siteId).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "tst_1",
    });
  });

  it("url-encodes the site id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await createTestHandler(client)({ ...args, siteId: "site/odd id" });
    expect(calls[0].path).toBe("/v1/sites/site%2Fodd%20id/tests");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "site_not_found", "No site with id 'x'"),
    });
    const result = await createTestHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("site_not_found");
  });
});
