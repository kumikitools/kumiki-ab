import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createTestArgs } from "../src/tools/create-test.js";

// Arg-validation layer (C0). The MCP SDK validates a tool's args against the
// raw shape before the handler runs; these assert that shape — composed from
// `@kumikitools/schema` primitives — accepts well-formed input and rejects what
// the API would 400 on, so bad calls fail at the edge with a useful path.
const schema = z.object(createTestArgs);

const valid = {
  siteId: "site_abc",
  name: "Hero CTA color",
  coverage: 0.5,
  variants: [
    { id: "control", weight: 1 },
    {
      id: "v1",
      weight: 1,
      changes: [{ selector: ".cta", type: "style", value: { color: "red" } }],
    },
  ],
};

describe("createTestArgs", () => {
  it("accepts a well-formed create-test call", () => {
    const parsed = schema.parse(valid);
    expect(parsed.siteId).toBe("site_abc");
    expect(parsed.variants).toHaveLength(2);
  });

  it("leaves server-side defaults absent (status/window) for the API to apply", () => {
    const parsed = schema.parse(valid);
    expect(parsed.status).toBeUndefined();
    expect(parsed.conversionWindowDays).toBeUndefined();
  });

  it("requires siteId", () => {
    const { siteId, ...noSite } = valid;
    void siteId;
    const res = schema.safeParse(noSite);
    expect(res.success).toBe(false);
  });

  it("requires a name", () => {
    const { name, ...noName } = valid;
    void name;
    expect(schema.safeParse(noName).success).toBe(false);
  });

  it("requires at least one variant", () => {
    const res = schema.safeParse({ ...valid, variants: [] });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toContain("variants");
    }
  });

  it("rejects coverage outside [0,1]", () => {
    expect(schema.safeParse({ ...valid, coverage: 1.5 }).success).toBe(false);
  });

  it("rejects a non-integer conversion window", () => {
    expect(schema.safeParse({ ...valid, conversionWindowDays: 2.5 }).success).toBe(
      false,
    );
  });

  it("validates nested variant changes via the shared contract schema", () => {
    const badChange = {
      ...valid,
      variants: [
        { id: "control", weight: 1 },
        // `type` is not one of the contract's ChangeType enum values.
        { id: "v1", weight: 1, changes: [{ selector: ".x", type: "frobnicate" }] },
      ],
    };
    expect(schema.safeParse(badChange).success).toBe(false);
  });
});
