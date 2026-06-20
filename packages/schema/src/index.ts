// The Kumiki A/B config contract — the single source of truth.
//
// zod schemas are authoritative; the TypeScript types are inferred from them
// (z.infer) so the two can never drift. Consumed by:
//   - the client snippet  → TYPE-ONLY imports (zod is never bundled into it)
//   - the Workers API/MCP  → runtime validation via the *Schema exports
//
// Kept deliberately small and trivially serialisable from D1.
import { z } from "zod";

/** How a Change mutates its matched element(s). */
export const ChangeTypeSchema = z.enum([
  "text", // textContent
  "html", // innerHTML
  "style", // inline style properties
  "attr", // attribute set/remove
  "class", // add/remove class names
  "hide", // display:none !important
  "remove", // detach element
]);

export const ChangeSchema = z.object({
  /** CSS selector the change targets. Applied to every match. */
  selector: z.string(),
  type: ChangeTypeSchema,
  /** Payload — meaning depends on `type`. See the snippet's applyChange. */
  value: z
    .union([z.string(), z.record(z.string(), z.string()), z.array(z.string())])
    .optional(),
});

export const VariantSchema = z.object({
  id: z.string(),
  /** Relative weight for traffic split. Control is just another variant. */
  weight: z.number(),
  /** DOM mutations that define this variant. Empty for control. */
  changes: z.array(ChangeSchema).optional(),
});

export const TestStatusSchema = z.enum([
  "running", // split traffic across variants by weight
  "applied", // winner rolled to 100% — the free hero feature
  "stopped", // do nothing, show original
]);

export const UrlMatchTypeSchema = z.enum([
  "exact", // href === value
  "prefix", // href starts with value
  "contains", // href includes value (substring)
  "wildcard", // value with * globs, e.g. "https://site.com/p/*"
  "regex", // value compiled as a RegExp against href
]);

export const UrlPatternSchema = z.object({
  type: UrlMatchTypeSchema,
  value: z.string(),
});

/**
 * Page targeting. A test runs on a URL when (include is empty/omitted OR any
 * include matches) AND no exclude matches. Matched against `location.href`.
 */
export const UrlTargetingSchema = z.object({
  include: z.array(UrlPatternSchema).optional(),
  exclude: z.array(UrlPatternSchema).optional(),
});

export const TestSchema = z.object({
  id: z.string(),
  status: TestStatusSchema,
  /** Fraction [0,1] of visitors entered into the experiment. Rest see control. */
  coverage: z.number().optional(),
  variants: z.array(VariantSchema),
  /** When status === "applied", the variant served to everyone. */
  winner: z.string().optional(),
  /** Page targeting. Omitted ⇒ runs on every page. */
  urlMatch: UrlTargetingSchema.optional(),
});

export const Ga4ConfigSchema = z.object({
  /** GA4 event name for exposure. Defaults to "experiment_impression". */
  eventName: z.string().optional(),
  /** Use gtag() if available, else dataLayer.push. Defaults to true. */
  enabled: z.boolean().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// Goal contract (D3) — site-level conversion goals that the snippet evaluates
// and fires as conversion beacons. Goals are variant-agnostic; credit is
// resolved at read time via first-exposure + window join (§4).

export const UrlGoalSchema = z.object({
  id: z.string(),
  type: z.literal("url"),
  /** URL targeting — same shape as test page targeting; conversion fires on match. */
  targeting: UrlTargetingSchema,
  /** Optional static revenue value for expected-revenue results (§4). */
  value: z.number().optional(),
});

export const ClickGoalSchema = z.object({
  id: z.string(),
  type: z.literal("click"),
  /** CSS selector: conversion fires when any matching element is clicked. */
  selector: z.string(),
  value: z.number().optional(),
});

export const FormGoalSchema = z.object({
  id: z.string(),
  type: z.literal("form"),
  /** CSS selector: conversion fires on submit of a form matching this selector. */
  selector: z.string(),
  value: z.number().optional(),
});

/** Site-level conversion goal — discriminated on `type`. */
export const GoalSchema = z.discriminatedUnion("type", [
  UrlGoalSchema,
  ClickGoalSchema,
  FormGoalSchema,
]);

export const KumikiConfigSchema = z.object({
  tests: z.array(TestSchema),
  /** Max ms to keep content hidden before failing open and revealing. */
  antiFlickerTimeout: z.number().optional(),
  ga4: Ga4ConfigSchema.optional(),
  /**
   * Site-level conversion goals (D3). The snippet evaluates these and emits
   * conversion beacons to `ingestUrl`. Omitted when the config is delivered
   * without goal authoring (pre-D3 clients treat absent field as no goals).
   */
  goals: z.array(GoalSchema).optional(),
  /**
   * The site identifier, carried in the config so the snippet can address the
   * beacon endpoint without knowing the request origin. Required when `ingestUrl`
   * is present. Omitted from manually-authored inline configs.
   */
  siteId: z.string().optional(),
  /**
   * The origin the snippet should POST beacons to (e.g. "https://api.kumiki.com").
   * Derived from the delivery request origin and baked in by the API. The snippet
   * appends `/v1/e/:siteId`. Omitted from inline configs without a known origin.
   */
  ingestUrl: z.string().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// The event/beacon contract — the SECOND source of truth, alongside KumikiConfig.
//
// This is the wire shape of the self-collected events (ARCH §2b/§3b): emitted by
// the snippet's beacon (D3) and received by the ingestion API (D1). Like
// KumikiConfig, it lives here once so emitter and receiver can never drift —
// the snippet imports the TYPES (zod stays out of its bundle), the API imports
// the runtime validators.
//
// Scope guardrail (Decisions §3): only what the user-based, windowed results
// model (§4) needs — an exposure (who saw which variant) and a conversion
// (who converted, optionally with revenue). Conversions are deliberately
// variant-agnostic; the variant is assigned at read time by first-exposure +
// window join (§2b/§4). If a third dimension creeps in here, stop.

/** Event-store field bounds — bound abuse without rejecting legitimate ids. */
const idField = z.string().min(1).max(128);
/** Client idempotency key — dedups retried beacons (ARCH §3b). Opaque, per-event. */
const idempotencyKey = z.string().min(1).max(200);
/** Client event time, epoch ms. The clock the window join (§4) is computed on. */
const eventTs = z.number().int().nonnegative();

/**
 * An exposure: a `visitorId` was assigned `variantId` of `testId`. First exposure
 * per (test, visitor) is the sticky bucket the results model assigns on (§4).
 */
export const ExposureEventSchema = z.object({
  type: z.literal("exposure"),
  key: idempotencyKey,
  ts: eventTs,
  /** Opaque visitor/bucket id — the snippet's own sticky id, not PII (§3b). */
  visitorId: idField,
  testId: idField,
  variantId: idField,
});

/**
 * A conversion: a `visitorId` hit `goal` (optionally worth `value`). NOT tagged
 * with a variant — one conversion serves every concurrent test; the credit is
 * resolved at read time against the visitor's first exposure + window (§2b/§4).
 */
export const ConversionEventSchema = z.object({
  type: z.literal("conversion"),
  key: idempotencyKey,
  ts: eventTs,
  visitorId: idField,
  goal: idField,
  /** Optional revenue value for expected-revenue results (§4). */
  value: z.number().optional(),
});

/** One event in a beacon batch — discriminated on `type`. */
export const KumikiEventSchema = z.discriminatedUnion("type", [
  ExposureEventSchema,
  ConversionEventSchema,
]);

/** Max events a single beacon may carry — the MVP per-request write guard (§3b). */
export const MAX_EVENTS_PER_BATCH = 100;

/**
 * The beacon body for `POST /v1/e/:siteId` — client-batched events (§3b). `siteId`
 * is NOT repeated per event; the ingestion route stamps it from the path.
 */
export const EventBatchSchema = z.object({
  events: z.array(KumikiEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

// ───────────────────────────────────────────────────────────────────────────
// The results contract — the THIRD source of truth, alongside KumikiConfig and
// the event/beacon shape above.
//
// This is the wire shape of the user-based, windowed Bayesian results (ARCH §4):
// produced by the API's `GET /v1/tests/:id/results` and consumed by the MCP
// `kumiki_get_results` tool and the dashboard. Like the other two contracts it
// lives here once so producer and consumers can never drift.
//
// Naming note: ARCH §4 sketches the shape with a snake_case `window_days`, but
// every wire contract in this package is camelCase (`conversionWindowDays`,
// `visitorId`, …) — so the field is `windowDays` here, consistent with the rest.
//
// The numbers (ARCH §4): per variant V in the test,
//   - exposed   = distinct visitors whose FIRST exposure in this test was to V
//   - converted = those who then converted within W days of their own exposure
//                 (post-exposure only)
//   - rate      = converted / exposed (0 when exposed is 0)
//   - pBest     = P(V is the best variant), Monte-Carlo over the beta-binomial
//                 posteriors Beta(α₀+X, β₀+(N−X)); pBest sums to ~1 across V
//   - ci95      = 95% credible interval on `rate`, as [lo, hi]
//   - revPerVisitor = expected revenue per exposed visitor; present only when the
//                 test has any conversion-value (revenue) signal

/** Per-variant results row (ARCH §4). Counts are integers; the rest are in [0,1]. */
export const VariantResultSchema = z.object({
  id: z.string(),
  /** Distinct visitors first-exposed to this variant (the sticky bucket). */
  exposed: z.number().int().nonnegative(),
  /** Exposed visitors who converted within the window, post-exposure. */
  converted: z.number().int().nonnegative(),
  /** converted / exposed; 0 when exposed is 0. */
  rate: z.number(),
  /** P(this variant is best), Monte-Carlo over posteriors. Sums to ~1 across variants. */
  pBest: z.number(),
  /** 95% credible interval on `rate`, as [lo, hi]. */
  ci95: z.tuple([z.number(), z.number()]),
  /** Expected revenue per exposed visitor. Present only when revenue was tracked. */
  revPerVisitor: z.number().optional(),
});

/**
 * The results summary for one test (ARCH §4 output shape). `winner` is the
 * posterior-decisive leader (a variant whose `pBest` clears the decision
 * threshold), distinct from the config `Test.winner` an operator *applied*.
 */
export const ResultsSchema = z.object({
  testId: z.string(),
  /** W — the conversion window the counts were computed against, in days. */
  windowDays: z.number().int().positive(),
  variants: z.array(VariantResultSchema),
  /** The variant the posterior calls best, if any clears the threshold. */
  winner: z.string().optional(),
});

// ───────────────────────────────────────────────────────────────────────────

// Inferred types — import these (type-only) everywhere. Never hand-maintain.
export type ChangeType = z.infer<typeof ChangeTypeSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type TestStatus = z.infer<typeof TestStatusSchema>;
export type UrlMatchType = z.infer<typeof UrlMatchTypeSchema>;
export type UrlPattern = z.infer<typeof UrlPatternSchema>;
export type UrlTargeting = z.infer<typeof UrlTargetingSchema>;
export type Test = z.infer<typeof TestSchema>;
export type Ga4Config = z.infer<typeof Ga4ConfigSchema>;
export type KumikiConfig = z.infer<typeof KumikiConfigSchema>;
export type VariantResult = z.infer<typeof VariantResultSchema>;
export type Results = z.infer<typeof ResultsSchema>;
export type ExposureEvent = z.infer<typeof ExposureEventSchema>;
export type ConversionEvent = z.infer<typeof ConversionEventSchema>;
export type KumikiEvent = z.infer<typeof KumikiEventSchema>;
export type EventBatch = z.infer<typeof EventBatchSchema>;
export type Goal = z.infer<typeof GoalSchema>;
