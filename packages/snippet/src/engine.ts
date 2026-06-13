// Orchestrator. Wires the pure pieces together with a single overriding rule:
// FAIL-OPEN. Any error, anywhere, must end with the page visible and the
// original content intact. The structure is therefore: hide → try(assign+apply)
// → always reveal.
import { assignVariant } from "./bucketing";
import { applyVariant } from "./apply";
import { hide, DEFAULT_TIMEOUT } from "./antiflicker";
import { sendExposure } from "./ga4";
import { browserStorage, getVisitorId } from "./storage";
import { matchesUrl } from "./urlmatch";
import type { KumikiConfig } from "./types";

export interface Assignment {
  testId: string;
  variantId: string;
}

export interface RunResult {
  visitorId: string;
  assignments: Assignment[];
}

/**
 * Run all tests for this page view. `win`/`doc` are injected so the engine is
 * unit-testable under jsdom without touching real globals.
 */
export function run(config: KumikiConfig, win: Window, doc: Document): RunResult {
  const result: RunResult = { visitorId: "", assignments: [] };

  // Hide immediately, before any assignment work, to prevent FOOC.
  const af = hide(doc, config.antiFlickerTimeout ?? DEFAULT_TIMEOUT);

  try {
    const store = browserStorage(win);
    const visitorId = getVisitorId(store);
    result.visitorId = visitorId;

    const url = win.location?.href ?? "";

    for (const test of config.tests ?? []) {
      // Page targeting: skip tests that don't apply to this URL.
      if (!matchesUrl(test.urlMatch, url)) continue;
      const variant = assignVariant(test, visitorId);
      if (!variant) continue;
      applyVariant(doc, variant);
      sendExposure(win, test, variant, config.ga4);
      result.assignments.push({ testId: test.id, variantId: variant.id });
    }
  } catch {
    // Swallow — reveal in finally guarantees the page is shown regardless.
  } finally {
    af.reveal();
  }

  return result;
}
