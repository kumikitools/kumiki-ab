// Anti-flicker: hide page content the instant the snippet runs so the original
// (control) DOM never paints before variant mutations are applied — the "FOOC"
// (flash of original content) problem. Critically paired with a hard timeout so
// a hung script can never leave the page invisible: that is the fail-open
// contract — when in doubt, show the page.

export const STYLE_ID = "_kumiki_af";
const DEFAULT_TIMEOUT = 4000;

export interface AntiFlicker {
  reveal(): void;
}

/**
 * Inject a stylesheet that hides <body> and schedule a safety reveal. Returns a
 * handle whose reveal() removes the hiding rule. Idempotent and self-healing:
 * the timeout guarantees reveal even if the caller never does.
 */
export function hide(doc: Document, timeoutMs = DEFAULT_TIMEOUT): AntiFlicker {
  let revealed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (timer !== undefined) clearTimeout(timer);
    const style = doc.getElementById(STYLE_ID);
    style?.parentNode?.removeChild(style);
  };

  try {
    // Idempotent: reuse an existing hiding rule (e.g. when the entry hides
    // synchronously before an async config fetch, then the engine hides again).
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      // Opacity (not display) keeps layout stable and avoids reflow on reveal.
      style.textContent = "body{opacity:0 !important}";
      const head = doc.head || doc.documentElement;
      head.appendChild(style);
    }
    // Fail-open safety net.
    timer = setTimeout(reveal, Math.max(0, timeoutMs));
  } catch {
    // If we couldn't even hide, there is nothing to reveal — page stays visible.
    revealed = true;
  }

  return { reveal };
}

export { DEFAULT_TIMEOUT };
