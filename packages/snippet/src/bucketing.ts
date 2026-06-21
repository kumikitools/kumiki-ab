// Deterministic, sticky variant assignment. Pure functions only — no DOM, no
// storage — so the same visitor always lands in the same variant regardless of
// where/when this runs, and so it is trivially unit-testable.
import type { Test, Variant } from "@kumikitools/schema";

/**
 * cyrb53 — a small, fast, well-distributed 53-bit string hash. We only need
 * uniformity, not cryptographic strength. Returns a non-negative integer.
 */
export function hash(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Map a string to a stable fraction in [0, 1). */
export function toUnitInterval(str: string): number {
  // 2^53 is the max value cyrb53 can produce.
  return hash(str) / 9007199254740992;
}

/**
 * Decide which variant a visitor sees for a test, or null if they are excluded
 * (not covered) or the test is inactive.
 *
 * Stickiness comes purely from the visitorId+testId hash, so this returns the
 * same answer on every page load without needing to persist the choice.
 */
export function assignVariant(test: Test, visitorId: string): Variant | null {
  if (test.status === "stopped") return null;

  if (test.status === "applied") {
    const winner = test.variants.find((v) => v.id === test.winner);
    // Winner rolled to 100% — the free hero feature.
    return winner ?? null;
  }

  // status === "running"
  if (!test.variants.length) return null;

  const coverage = test.coverage ?? 1;
  if (coverage < 1) {
    // A separate hash dimension decides inclusion, independent of variant pick,
    // so changing coverage doesn't reshuffle which variant included users get.
    if (toUnitInterval(`${visitorId}:${test.id}:coverage`) >= coverage) {
      return null;
    }
  }

  const total = test.variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
  if (total <= 0) return null;

  let point = toUnitInterval(`${visitorId}:${test.id}`) * total;
  for (const variant of test.variants) {
    point -= Math.max(0, variant.weight);
    if (point < 0) return variant;
  }
  // Floating-point edge: fall back to the last variant.
  return test.variants[test.variants.length - 1];
}
