// Browser entry. Wires real globals into the engine and resolves config from
// one of two sources, in priority order:
//
//   1. window.KUMIKI_CONFIG — inline config. Zero-flicker: assignment is
//      synchronous, so variants apply before first paint. Preferred.
//   2. <script ... data-config-url="..."> — fetched from the Workers API. We
//      hide synchronously first so the network round-trip never flashes the
//      original content, then apply and reveal.
//
// Everything is wrapped so a failure to even bootstrap reveals the page.
import { run } from "./engine";
import { hide, DEFAULT_TIMEOUT } from "./antiflicker";
import { createBeacon } from "./beacon";
import { initGoals } from "./goals";
import type { KumikiConfig } from "@kumikitools/schema";

type TrackFn = (goal: string, opts?: { value?: number }) => void;

interface KumikiWindow extends Window {
  KUMIKI_CONFIG?: KumikiConfig;
  KUMIKI?: { run: typeof run; track?: TrackFn };
}

function currentScript(doc: Document): HTMLScriptElement | null {
  if (doc.currentScript instanceof HTMLScriptElement) return doc.currentScript;
  // Fallback for async/deferred execution where currentScript is null.
  const byAttr = doc.querySelector<HTMLScriptElement>("script[data-config-url]");
  return byAttr ?? null;
}

function wireBeacon(cfg: KumikiConfig, win: KumikiWindow, doc: Document): void {
  if (!cfg.siteId || !cfg.ingestUrl) return;
  const beacon = createBeacon(win, cfg.siteId, cfg.ingestUrl);
  const result = run(cfg, win, doc, beacon);
  if (cfg.goals?.length) initGoals(cfg.goals, result.visitorId, beacon, win, doc);
  win.KUMIKI!.track = (goal, opts) => beacon.enqueueConversion(goal, result.visitorId, opts);
}

function bootstrap(win: KumikiWindow, doc: Document): void {
  // Expose the engine for programmatic use / debugging.
  win.KUMIKI = { run };

  const inline = win.KUMIKI_CONFIG;
  if (inline && Array.isArray(inline.tests)) {
    if (inline.siteId && inline.ingestUrl) {
      wireBeacon(inline, win, doc);
    } else {
      run(inline, win, doc);
    }
    return;
  }

  const script = currentScript(doc);
  const url = script?.getAttribute("data-config-url");
  if (!url) return; // Nothing to do — no config provided.

  const timeout = inline?.antiFlickerTimeout ?? DEFAULT_TIMEOUT;
  // Hide before the fetch so the network latency doesn't flash control.
  const af = hide(doc, timeout);
  try {
    win
      .fetch(url, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((cfg: KumikiConfig) => {
        if (cfg.siteId && cfg.ingestUrl) {
          wireBeacon(cfg, win, doc);
        } else {
          run(cfg, win, doc);
        }
        af.reveal();
      })
      .catch(() => af.reveal()); // Fail-open on any network/parse error.
  } catch {
    af.reveal();
  }
}

try {
  bootstrap(window as KumikiWindow, document);
} catch {
  // Last-resort: never leave the page hidden if bootstrap itself throws.
  try {
    document.getElementById("_kumiki_af")?.remove();
  } catch {
    /* noop */
  }
}
