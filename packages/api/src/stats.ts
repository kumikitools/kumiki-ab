/**
 * Beta-binomial posterior math for the results route (ARCHITECTURE.md §4) — the
 * new foundation bit of D2, kept as a PURE module (no D1, no Hono) so it is
 * trivially unit-testable in isolation from the SQL and the HTTP envelope.
 *
 * The model (§4): each variant V is a Bernoulli trial — N = exposed visitors,
 * X = converted. With a Beta(α₀, β₀) prior the posterior is
 * `Beta(α₀ + X, β₀ + (N − X))`. From those posteriors we report:
 *   - `pBest`  = P(V has the highest true rate), estimated by Monte-Carlo: draw
 *                one sample per variant per iteration, count how often each wins.
 *   - `ci95`   = the 2.5/97.5 percentiles of V's posterior samples (credible
 *                interval on the rate).
 *
 * Determinism: pBest/ci95 are Monte-Carlo, so the sampler is driven by an
 * INJECTED seeded RNG (default: a fixed seed). Same counts + same seed ⇒ byte-
 * identical output, which is what makes the posterior-sanity tests reproducible
 * rather than flaky (the DoD depends on this).
 *
 * §9.8 note: no sampling-rate posterior correction at MVP volume — exposures are
 * not down-sampled yet, so N/X are exact.
 */

/** A pseudo-random source in [0, 1). Injectable so results are reproducible. */
export type Rng = () => number;

/**
 * mulberry32 — a tiny, fast, well-distributed seeded PRNG. Deterministic given
 * its 32-bit seed, which is the whole point: it makes the Monte-Carlo estimates
 * reproducible without pulling in a dependency.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard-normal draw via Box-Muller (used by the Gamma sampler). */
function sampleNormal(rng: Rng): number {
  // Guard the log against u1 === 0.
  let u1 = rng();
  while (u1 <= 0) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Gamma(shape, 1) via Marsaglia–Tsang. Handles shape < 1 with the standard boost
 * `Gamma(a) = Gamma(a + 1) · U^(1/a)`, so any prior (incl. Jeffreys α₀=½) works.
 */
function sampleGamma(rng: Rng, shape: number): number {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(rng, shape + 1) * Math.pow(u <= 0 ? Number.MIN_VALUE : u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Rejection loop — expected iterations ~1, so this terminates promptly.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const x = sampleNormal(rng);
    const v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    let u = rng();
    while (u <= 0) u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) as the ratio of two Gamma draws — the posterior rate sampler. */
function sampleBeta(rng: Rng, a: number, b: number): number {
  const x = sampleGamma(rng, a);
  const y = sampleGamma(rng, b);
  const s = x + y;
  return s === 0 ? 0 : x / s;
}

/** Raw per-variant counts fed into the posterior (the SQL aggregation's output). */
export interface VariantCounts {
  id: string;
  exposed: number;
  converted: number;
  /** Total tracked revenue across this variant's converting visitors (optional). */
  revenue?: number;
  /** Visitors with at least one revenue-bearing conversion (for averaging). */
  revenueVisitors?: number;
}

/** A variant's computed posterior summary (ARCH §4, sans the contract framing). */
export interface VariantPosterior {
  id: string;
  exposed: number;
  converted: number;
  rate: number;
  pBest: number;
  ci95: [number, number];
  revPerVisitor?: number;
}

export interface PosteriorResult {
  variants: VariantPosterior[];
  /** The decisive leader: argmax pBest, but only if it clears `winnerThreshold`. */
  winner?: string;
}

export interface PosteriorOptions {
  /** Beta prior. Default uniform Beta(1, 1) — Laplace, posterior mean (X+1)/(N+2). */
  priorAlpha?: number;
  priorBeta?: number;
  /** Monte-Carlo iterations. Higher ⇒ smoother pBest/ci95 at linear cost. */
  samples?: number;
  /** Seed for the default RNG (ignored if `rng` is supplied). */
  seed?: number;
  /** Inject a custom RNG (tests pass a fixed one); defaults to mulberry32(seed). */
  rng?: Rng;
  /** pBest a variant must reach to be named `winner`. Default 0.95. */
  winnerThreshold?: number;
}

const DEFAULT_SAMPLES = 20_000;
const DEFAULT_SEED = 0x5eed; // fixed → reproducible posteriors
const DEFAULT_WINNER_THRESHOLD = 0.95;

/**
 * Compute the windowed beta-binomial summary for a test's variants (ARCH §4).
 *
 * One shared sample matrix drives both estimates: for each variant we draw
 * `samples` posterior rates; pBest counts per-iteration argmax wins, and ci95 is
 * that variant's own 2.5/97.5 percentiles. Variants with no exposures still get a
 * posterior (the prior), so an unobserved arm doesn't crash the comparison.
 */
export function computePosteriors(
  counts: VariantCounts[],
  opts: PosteriorOptions = {},
): PosteriorResult {
  const priorAlpha = opts.priorAlpha ?? 1;
  const priorBeta = opts.priorBeta ?? 1;
  const samples = opts.samples ?? DEFAULT_SAMPLES;
  const winnerThreshold = opts.winnerThreshold ?? DEFAULT_WINNER_THRESHOLD;
  const rng = opts.rng ?? mulberry32(opts.seed ?? DEFAULT_SEED);

  const k = counts.length;
  // Draw the whole matrix up front: draws[v][s] = posterior rate sample.
  const draws: number[][] = counts.map((c) => {
    const a = priorAlpha + c.converted;
    const b = priorBeta + Math.max(0, c.exposed - c.converted);
    const row = new Array<number>(samples);
    for (let s = 0; s < samples; s++) row[s] = sampleBeta(rng, a, b);
    return row;
  });

  // pBest: per iteration, find the variant with the largest sampled rate.
  const wins = new Array<number>(k).fill(0);
  if (k > 0) {
    for (let s = 0; s < samples; s++) {
      let best = 0;
      for (let v = 1; v < k; v++) {
        if (draws[v][s] > draws[best][s]) best = v;
      }
      wins[best]++;
    }
  }

  const variants: VariantPosterior[] = counts.map((c, v) => {
    const rate = c.exposed > 0 ? c.converted / c.exposed : 0;
    const pBest = samples > 0 ? wins[v] / samples : 0;
    const variant: VariantPosterior = {
      id: c.id,
      exposed: c.exposed,
      converted: c.converted,
      rate,
      pBest,
      ci95: percentileInterval(draws[v], 0.025, 0.975),
    };
    if (c.revenue !== undefined) {
      variant.revPerVisitor = c.exposed > 0 ? c.revenue / c.exposed : 0;
    }
    return variant;
  });

  // Winner = the leader, but only if the data is decisive enough to name one.
  let winner: string | undefined;
  let leader = -1;
  for (let v = 0; v < k; v++) {
    if (leader < 0 || variants[v].pBest > variants[leader].pBest) leader = v;
  }
  if (leader >= 0 && variants[leader].pBest >= winnerThreshold) {
    winner = variants[leader].id;
  }

  return { variants, winner };
}

/** The [lo, hi] percentiles of a sample array (sorted copy; linear interpolation). */
function percentileInterval(
  sampleArray: number[],
  lo: number,
  hi: number,
): [number, number] {
  if (sampleArray.length === 0) return [0, 0];
  const sorted = [...sampleArray].sort((x, y) => x - y);
  return [quantile(sorted, lo), quantile(sorted, hi)];
}

/** A single quantile of an already-sorted array (linear interpolation). */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base];
  const upper = sorted[base + 1] ?? lower;
  return lower + rest * (upper - lower);
}
