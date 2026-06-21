import { describe, it, expect } from "vitest";
import { computePosteriors, mulberry32, type VariantCounts } from "../src/stats";

// D2 — the beta-binomial posterior math (ARCH §4), tested as a pure unit in
// isolation from D1/Hono. The sampler is seeded, so every assertion below is
// deterministic (no flaky Monte-Carlo). Defaults use a fixed seed; we also pass
// explicit seeds to prove reproducibility.

describe("computePosteriors — determinism", () => {
  const counts: VariantCounts[] = [
    { id: "control", exposed: 1000, converted: 100 },
    { id: "v1", exposed: 1000, converted: 130 },
  ];

  it("is byte-identical for the same counts + seed", () => {
    const a = computePosteriors(counts, { seed: 42, samples: 5000 });
    const b = computePosteriors(counts, { seed: 42, samples: 5000 });
    expect(a).toEqual(b);
  });

  it("accepts an injected RNG (same draws ⇒ same output)", () => {
    const a = computePosteriors(counts, { rng: mulberry32(7), samples: 5000 });
    const b = computePosteriors(counts, { rng: mulberry32(7), samples: 5000 });
    expect(a.variants.map((v) => v.pBest)).toEqual(b.variants.map((v) => v.pBest));
  });

  it("the default seed is fixed (no-args call is reproducible)", () => {
    expect(computePosteriors(counts)).toEqual(computePosteriors(counts));
  });
});

describe("computePosteriors — posterior sanity", () => {
  it("gives a clearly-winning variant high pBest", () => {
    const res = computePosteriors(
      [
        { id: "control", exposed: 2000, converted: 100 }, // 5%
        { id: "v1", exposed: 2000, converted: 300 }, //       15%
      ],
      { seed: 1 },
    );
    const v1 = res.variants.find((v) => v.id === "v1")!;
    expect(v1.pBest).toBeGreaterThan(0.99);
    expect(res.winner).toBe("v1");
  });

  it("splits pBest ~evenly between statistically tied variants", () => {
    const res = computePosteriors(
      [
        { id: "a", exposed: 1000, converted: 100 },
        { id: "b", exposed: 1000, converted: 100 },
      ],
      { seed: 2 },
    );
    expect(res.variants[0].pBest).toBeGreaterThan(0.35);
    expect(res.variants[0].pBest).toBeLessThan(0.65);
    // Not decisive enough to name a winner.
    expect(res.winner).toBeUndefined();
  });

  it("pBest sums to ~1 across all variants", () => {
    const res = computePosteriors(
      [
        { id: "a", exposed: 800, converted: 80 },
        { id: "b", exposed: 800, converted: 95 },
        { id: "c", exposed: 800, converted: 70 },
      ],
      { seed: 3 },
    );
    const total = res.variants.reduce((s, v) => s + v.pBest, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("computes rate and brackets it inside ci95", () => {
    const res = computePosteriors([{ id: "a", exposed: 1000, converted: 120 }], {
      seed: 4,
    });
    const a = res.variants[0];
    expect(a.rate).toBeCloseTo(0.12, 10);
    expect(a.ci95[0]).toBeLessThan(0.12);
    expect(a.ci95[1]).toBeGreaterThan(0.12);
    // A single variant is trivially best.
    expect(a.pBest).toBe(1);
  });

  it("handles a zero-exposure arm without crashing (rate 0, prior CI)", () => {
    const res = computePosteriors(
      [
        { id: "a", exposed: 500, converted: 50 },
        { id: "unseen", exposed: 0, converted: 0 },
      ],
      { seed: 5 },
    );
    const unseen = res.variants.find((v) => v.id === "unseen")!;
    expect(unseen.rate).toBe(0);
    expect(unseen.ci95[0]).toBeGreaterThanOrEqual(0);
    expect(unseen.ci95[1]).toBeLessThanOrEqual(1);
    expect(unseen.ci95[0]).toBeLessThan(unseen.ci95[1]);
  });
});

describe("computePosteriors — revenue", () => {
  it("emits revPerVisitor = revenue / exposed when revenue is supplied", () => {
    const res = computePosteriors(
      [{ id: "a", exposed: 200, converted: 20, revenue: 1000 }],
      { seed: 6 },
    );
    expect(res.variants[0].revPerVisitor).toBeCloseTo(5, 10); // 1000 / 200
  });

  it("omits revPerVisitor when no revenue is supplied", () => {
    const res = computePosteriors([{ id: "a", exposed: 200, converted: 20 }], {
      seed: 6,
    });
    expect(res.variants[0].revPerVisitor).toBeUndefined();
  });
});
