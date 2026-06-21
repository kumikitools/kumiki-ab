import { describe, it, expect } from "vitest";
import { editTestHandler } from "../src/tools/edit-test.js";
import { ApiClient } from "../src/api-client.js";
import { ApiClientError } from "../src/errors.js";
import type { EditTestArgs } from "../src/tools/edit-test.js";

// The C3 tool's handler, exercised against a fake ApiClient — the same two
// things every replica (C1–C8) must get right: it strips the path param
// (`testId`) into the URL and sends the rest as the PATCH body, and it routes
// success vs. API failure through the shared result mappers.

/** A stand-in ApiClient that records the call and returns a canned outcome. */
function fakeClient(outcome: { resolve?: unknown; reject?: unknown }): {
  client: ApiClient;
  calls: { path: string; body: unknown }[];
} {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    patch(path: string, body: unknown) {
      calls.push({ path, body });
      if (outcome.reject) return Promise.reject(outcome.reject);
      return Promise.resolve(outcome.resolve);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const args: EditTestArgs = {
  testId: "tst_1",
  name: "Hero CTA v2",
  status: "stopped",
};

describe("editTestHandler", () => {
  it("patches the test route with the body (testId stripped)", async () => {
    const { client, calls } = fakeClient({ resolve: { id: "tst_1" } });
    const result = await editTestHandler(client)(args);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/tests/tst_1");
    expect(calls[0].body).toEqual({ name: "Hero CTA v2", status: "stopped" });
    expect((calls[0].body as Record<string, unknown>).testId).toBeUndefined();

    expect(result.isError).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      id: "tst_1",
    });
  });

  it("url-encodes the test id into the path", async () => {
    const { client, calls } = fakeClient({ resolve: {} });
    await editTestHandler(client)({ ...args, testId: "tst/odd id" });
    expect(calls[0].path).toBe("/v1/tests/tst%2Fodd%20id");
  });

  it("maps an API failure to a tool error preserving the code", async () => {
    const { client } = fakeClient({
      reject: new ApiClientError(404, "test_not_found", "No test with id 'x'"),
    });
    const result = await editTestHandler(client)(args);

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("test_not_found");
  });

  it("surfaces the API's invalid_body when no fields are provided", async () => {
    // The "at least one field" rule lives in the API; the handler just forwards
    // the (empty) body and surfaces invalid_body — it does not re-implement it.
    const { client, calls } = fakeClient({
      reject: new ApiClientError(400, "invalid_body", "Request body failed validation"),
    });
    const result = await editTestHandler(client)({ testId: "tst_1" });

    expect(calls[0].body).toEqual({});
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error.code).toBe("invalid_body");
  });
});
