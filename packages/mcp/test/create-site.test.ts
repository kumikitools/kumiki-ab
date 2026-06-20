import { describe, it, expect } from "vitest";
import { createSiteHandler } from "../src/tools/create-site.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { CreateSiteArgs } from "../src/tools/create-site.js";

// C7 mirrors the reference tool's test (create-test.test.ts): the handler is
// exercised against a fake ApiClient so we assert the two things a replica must
// get right. C7's wrinkle vs C0: there is NO path param — the whole arg object
// is the body — and the success resource carries the one-time `writeKey`, which
// must reach the caller untouched.

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

const args: CreateSiteArgs = { name: "Acme Store" };

describe("createSiteHandler", () => {
  it("posts to /v1/sites with the args as the body (no path param)", async () => {
    const { client, calls } = fakeClient({
      resolve: {
        id: "site_1",
        name: "Acme Store",
        createdAt: 1700000000000,
        writeKey: "ksk_secret",
      },
    });
    const result = await createSiteHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/sites");
    expect(calls[0].body).toEqual({ name: "Acme Store" });

    expect(result.isError).toBeUndefined();
    // The one-time writeKey is surfaced verbatim in the resource JSON.
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "site_1",
      name: "Acme Store",
      createdAt: 1700000000000,
      writeKey: "ksk_secret",
    });
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(400, "invalid_body", "name is required"),
    });
    const result = await createSiteHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("invalid_body");
  });
});
