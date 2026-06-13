// GA4 exposure events. We do not collect our own analytics (per strategy: rely
// on GA4). On each variant assignment we push an exposure event so the
// experiment dimension is joinable against GA4 conversions for Bayesian
// analysis downstream.
import type { Ga4Config, Test, Variant } from "./types";

const DEFAULT_EVENT = "experiment_impression";

interface GtagWindow extends Window {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
}

/**
 * Emit one exposure event for a (test, variant) assignment. Prefers gtag() when
 * present, otherwise pushes onto dataLayer (GTM). Never throws.
 */
export function sendExposure(
  win: Window,
  test: Test,
  variant: Variant,
  cfg?: Ga4Config,
): void {
  if (cfg?.enabled === false) return;
  const eventName = cfg?.eventName || DEFAULT_EVENT;
  const params = {
    experiment_id: test.id,
    variant_id: variant.id,
  };

  try {
    const w = win as GtagWindow;
    if (typeof w.gtag === "function") {
      w.gtag("event", eventName, params);
      return;
    }
    // GTM / fallback path: push a flat event object onto the dataLayer.
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: eventName, ...params });
  } catch {
    // Exposure tracking must never break the page.
  }
}
