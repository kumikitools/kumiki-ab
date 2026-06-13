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

export const KumikiConfigSchema = z.object({
  tests: z.array(TestSchema),
  /** Max ms to keep content hidden before failing open and revealing. */
  antiFlickerTimeout: z.number().optional(),
  ga4: Ga4ConfigSchema.optional(),
});

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
