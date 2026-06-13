import { describe, expect, it } from "vitest";
import { assignVariant, toUnitInterval } from "../src/bucketing";
import type { Test } from "../src/types";

const ab: Test = {
  id: "t1",
  status: "running",
  variants: [
    { id: "control", weight: 1 },
    { id: "v1", weight: 1, changes: [{ selector: "h1", type: "text", value: "B" }] },
  ],
};

describe("toUnitInterval", () => {
  it("is deterministic and within [0,1)", () => {
    for (const s of ["a", "abc", "visitor:test", "", "🌟"]) {
      const x = toUnitInterval(s);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(toUnitInterval(s)).toBe(x);
    }
  });

  it("spreads roughly uniformly", () => {
    const buckets = new Array(10).fill(0);
    const N = 10000;
    for (let i = 0; i < N; i++) {
      buckets[Math.floor(toUnitInterval(`visitor-${i}`) * 10)]++;
    }
    for (const count of buckets) {
      // Each decile should hold ~10% — allow generous slack.
      expect(count).toBeGreaterThan(N * 0.07);
      expect(count).toBeLessThan(N * 0.13);
    }
  });
});

describe("assignVariant — stickiness", () => {
  it("returns the same variant for the same visitor every time", () => {
    for (let i = 0; i < 500; i++) {
      const vid = `vid-${i}`;
      const first = assignVariant(ab, vid)?.id;
      for (let k = 0; k < 5; k++) {
        expect(assignVariant(ab, vid)?.id).toBe(first);
      }
    }
  });
});

describe("assignVariant — weighting", () => {
  it("splits ~50/50 for equal weights", () => {
    let v1 = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      if (assignVariant(ab, `vid-${i}`)?.id === "v1") v1++;
    }
    expect(v1 / N).toBeGreaterThan(0.45);
    expect(v1 / N).toBeLessThan(0.55);
  });

  it("respects a 90/10 split", () => {
    const skewed: Test = {
      id: "t2",
      status: "running",
      variants: [
        { id: "control", weight: 9 },
        { id: "v1", weight: 1 },
      ],
    };
    let v1 = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      if (assignVariant(skewed, `vid-${i}`)?.id === "v1") v1++;
    }
    expect(v1 / N).toBeGreaterThan(0.07);
    expect(v1 / N).toBeLessThan(0.13);
  });
});

describe("assignVariant — coverage", () => {
  it("excludes the right fraction and keeps inclusion sticky", () => {
    const covered: Test = { ...ab, id: "t3", coverage: 0.3 };
    let included = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const got = assignVariant(covered, `vid-${i}`);
      if (got) included++;
    }
    expect(included / N).toBeGreaterThan(0.25);
    expect(included / N).toBeLessThan(0.35);
  });
});

describe("assignVariant — status", () => {
  it("returns null for a stopped test", () => {
    expect(assignVariant({ ...ab, status: "stopped" }, "vid")).toBeNull();
  });

  it("returns the winner for everyone when applied", () => {
    const applied: Test = { ...ab, status: "applied", winner: "v1" };
    for (let i = 0; i < 1000; i++) {
      expect(assignVariant(applied, `vid-${i}`)?.id).toBe("v1");
    }
  });

  it("returns null when applied winner is missing", () => {
    expect(assignVariant({ ...ab, status: "applied", winner: "ghost" }, "vid")).toBeNull();
  });

  it("returns null when all weights are zero", () => {
    const zero: Test = {
      id: "z",
      status: "running",
      variants: [{ id: "a", weight: 0 }, { id: "b", weight: 0 }],
    };
    expect(assignVariant(zero, "vid")).toBeNull();
  });
});
