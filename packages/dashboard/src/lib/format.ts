/** Small presentation helpers shared across pages. Pure, no I/O. */

/** A fraction (0–1) as a percentage string, e.g. 0.5 → "50%". `undefined` → "100%". */
export function coveragePct(coverage: number | undefined): string {
  if (coverage === undefined) return "100%";
  return `${round(coverage * 100, 1)}%`;
}

/** A conversion rate (0–1) as a percentage with 2 decimals, e.g. 0.0123 → "1.23%". */
export function ratePct(rate: number): string {
  return `${round(rate * 100, 2)}%`;
}

/** A probability (0–1) as a percentage with 1 decimal, e.g. 0.95 → "95.0%". */
export function probPct(p: number): string {
  return `${round(p * 100, 1)}%`;
}

export function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Epoch ms → short local date-time, e.g. "Jun 21, 14:30". */
export function formatTs(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
