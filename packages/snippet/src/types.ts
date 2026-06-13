// Config contract shared between the Workers API and this client snippet.
// Kept deliberately small: the snippet must stay tiny and the schema must be
// trivially serialisable from D1.

export type ChangeType =
  | "text" // textContent
  | "html" // innerHTML
  | "style" // inline style properties
  | "attr" // attribute set/remove
  | "class" // add/remove class names
  | "hide" // display:none
  | "remove"; // detach element

export interface Change {
  /** CSS selector the change targets. Applied to every match. */
  selector: string;
  type: ChangeType;
  /** Payload — meaning depends on `type`. See applyChange for the contract. */
  value?: string | Record<string, string> | string[];
}

export interface Variant {
  id: string;
  /** Relative weight for traffic split. Control is just another variant. */
  weight: number;
  /** DOM mutations that define this variant. Empty for control. */
  changes?: Change[];
}

export type TestStatus =
  | "running" // split traffic across variants by weight
  | "applied" // winner rolled to 100% — the free hero feature
  | "stopped"; // do nothing, show original

export type UrlMatchType =
  | "exact" // href === value
  | "prefix" // href starts with value
  | "contains" // href includes value (substring)
  | "wildcard" // value with * globs, e.g. "https://site.com/p/*"
  | "regex"; // value compiled as a RegExp against href

export interface UrlPattern {
  type: UrlMatchType;
  value: string;
}

/**
 * Page targeting. A test runs on a URL when: (include is empty/omitted OR any
 * include pattern matches) AND no exclude pattern matches. Matched against the
 * full `location.href`.
 */
export interface UrlTargeting {
  include?: UrlPattern[];
  exclude?: UrlPattern[];
}

export interface Test {
  id: string;
  status: TestStatus;
  /** Fraction [0,1] of visitors entered into the experiment. Rest see control. */
  coverage?: number;
  variants: Variant[];
  /** When status === "applied", the variant served to everyone. */
  winner?: string;
  /** Page targeting. Omitted ⇒ runs on every page. */
  urlMatch?: UrlTargeting;
}

export interface Ga4Config {
  /** GA4 event name for exposure. Defaults to "experiment_impression". */
  eventName?: string;
  /** Use gtag() if available, else dataLayer.push. Defaults to true. */
  enabled?: boolean;
}

export interface KumikiConfig {
  tests: Test[];
  /** Max ms to keep content hidden before failing open and revealing. */
  antiFlickerTimeout?: number;
  ga4?: Ga4Config;
}
