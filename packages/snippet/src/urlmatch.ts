// Page targeting. Pure functions over a URL string so they are trivially
// testable and identical wherever they run. A test is active on a page when an
// include matches (or there are none) and no exclude matches.
import type { UrlPattern, UrlTargeting } from "@kumikitools/schema";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does a single pattern match the URL? Invalid regex/wildcards fail closed. */
export function matchesPattern(pattern: UrlPattern, url: string): boolean {
  const { type, value } = pattern;
  try {
    switch (type) {
      case "exact":
        return url === value;
      case "prefix":
        return url.startsWith(value);
      case "contains":
        return url.includes(value);
      case "wildcard": {
        // Escape everything, then turn the escaped "*" back into ".*".
        const rx = new RegExp("^" + escapeRegExp(value).replace(/\\\*/g, ".*") + "$");
        return rx.test(url);
      }
      case "regex":
        return new RegExp(value).test(url);
      default:
        return false;
    }
  } catch {
    // Malformed pattern ⇒ don't match (don't accidentally run everywhere).
    return false;
  }
}

/**
 * Resolve targeting for a URL. No targeting ⇒ runs everywhere. An empty/omitted
 * include list means "all pages"; excludes always win.
 */
export function matchesUrl(targeting: UrlTargeting | undefined, url: string): boolean {
  if (!targeting) return true;

  const { include, exclude } = targeting;

  if (exclude && exclude.some((p) => matchesPattern(p, url))) return false;

  if (include && include.length > 0) {
    return include.some((p) => matchesPattern(p, url));
  }
  return true;
}
