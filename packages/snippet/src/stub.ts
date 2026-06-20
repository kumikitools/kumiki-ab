import { STYLE_ID, DEFAULT_TIMEOUT } from "./antiflicker";

/**
 * Inject the anti-flicker hiding rule into `<head>` and schedule a fail-open
 * timeout. Designed to be placed in `<head>` before the GTM snippet so the
 * page is hidden synchronously before GTM loads the real kumiki snippet.
 *
 * Interoperates with the snippet's `hide()` / `reveal()` by sharing the
 * `STYLE_ID` — if the stub already injected the rule, `hide()` is a no-op
 * (idempotent), and `reveal()` removes the same element regardless of which
 * one created it.
 */
export function installStub(doc: Document, timeoutMs = DEFAULT_TIMEOUT): void {
  try {
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = "body{opacity:0 !important}";
      (doc.head || doc.documentElement).appendChild(style);
    }
    setTimeout(() => {
      doc.getElementById(STYLE_ID)?.remove();
    }, Math.max(0, timeoutMs));
  } catch {
    // Fail-open: if we couldn't hide, leave the page visible.
  }
}

/**
 * Copy-paste HTML for the GTM install tier. Place in `<head>` before the GTM
 * snippet. Built from the same constants as the snippet so it can never drift.
 */
export const STUB_HTML: string =
  `<style id="${STYLE_ID}">body{opacity:0 !important}</style>` +
  `<script>setTimeout(function(){var e=document.getElementById("${STYLE_ID}");` +
  `if(e)e.parentNode.removeChild(e);},${DEFAULT_TIMEOUT});</script>`;
