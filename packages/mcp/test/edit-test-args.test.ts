import { describe, it, expect } from "vitest";
import { z } from "zod";
import { editTestArgs } from "../src/tools/edit-test.js";

// Arg-validation layer for C3. The shape is composed from `@kumikitools/schema`
// primitives (status, urlMatch) + control-plane scalars; only `testId` is
// required. The "at least one field" rule is the API's (invalid_body), so the
// arg shape itself accepts a testId-only call and lets the handler forward it.
const schema = z.object(editTestArgs);

describe("editTestArgs", () => {
  it("accepts a well-formed partial edit", () => {
    const parsed = schema.parse({
      testId: "tst_1",
      coverage: 0.25,
      status: "applied",
    });
    expect(parsed.testId).toBe("tst_1");
    expect(parsed.status).toBe("applied");
  });

  it("requires testId", () => {
    expect(schema.safeParse({ name: "x" }).success).toBe(false);
  });

  it("accepts a testId-only call (the API enforces at-least-one-field)", () => {
    expect(schema.safeParse({ testId: "tst_1" }).success).toBe(true);
  });

  it("rejects a status outside the contract enum", () => {
    expect(
      schema.safeParse({ testId: "tst_1", status: "frobnicate" }).success,
    ).toBe(false);
  });

  it("rejects coverage outside [0,1]", () => {
    expect(schema.safeParse({ testId: "tst_1", coverage: 1.5 }).success).toBe(false);
  });

  it("rejects a non-integer conversion window", () => {
    expect(
      schema.safeParse({ testId: "tst_1", conversionWindowDays: 2.5 }).success,
    ).toBe(false);
  });
});
