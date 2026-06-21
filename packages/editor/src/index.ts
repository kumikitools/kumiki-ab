// Bookmarklet entry point (ARCH §9.7). The bookmarklet sets `window.__kumikiEditor`
// = { origin, token } and then injects this bundle onto the user's live page.
// We boot the overlay, and — if the dashboard opened this tab (window.opener) —
// handshake with it so the authored changes[] flow straight back into the F1
// variants editor. With no opener, the overlay still works via "Copy JSON".
import type { Change } from "@kumikitools/schema";
import { Overlay } from "./overlay";
import {
  KUMIKI_EDITOR,
  PROTOCOL_VERSION,
  parseEditorMessage,
  type ChangesMessage,
  type ReadyMessage,
} from "./messages";

interface BootConfig {
  origin: string;
  token: string;
}

function readConfig(): BootConfig | null {
  const g = (window as unknown as { __kumikiEditor?: Partial<BootConfig> }).__kumikiEditor;
  if (g && typeof g.origin === "string" && typeof g.token === "string") {
    return { origin: g.origin, token: g.token };
  }
  return null;
}

function boot(): void {
  // Guard against the user clicking the bookmarklet twice.
  if ((window as unknown as { __kumikiEditorActive?: boolean }).__kumikiEditorActive) return;
  (window as unknown as { __kumikiEditorActive?: boolean }).__kumikiEditorActive = true;

  const config = readConfig();
  const dashboard = window.opener as Window | null;
  const connected = Boolean(config && dashboard);

  const send = (changes: Change[]): void => {
    if (!config || !dashboard) return;
    const msg: ChangesMessage = {
      kumiki: KUMIKI_EDITOR,
      v: PROTOCOL_VERSION,
      type: "changes",
      token: config.token,
      changes,
    };
    dashboard.postMessage(msg, config.origin);
  };

  let overlay = new Overlay({ initialChanges: [], hasDashboard: connected, onSend: send });
  overlay.mount();

  if (!config || !dashboard) return;

  // Accept the dashboard's reply (the changes already on the variant) once, and
  // restart the overlay seeded with them so the user extends rather than restarts.
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.origin !== config.origin) return;
    const m = parseEditorMessage(e.data, config.token);
    if (m?.type === "init" && Array.isArray(m.changes) && m.changes.length) {
      overlay.destroy();
      overlay = new Overlay({ initialChanges: m.changes, hasDashboard: true, onSend: send });
      overlay.mount();
    }
  });

  // Announce readiness so the dashboard can send us the existing changes[].
  const ready: ReadyMessage = {
    kumiki: KUMIKI_EDITOR,
    v: PROTOCOL_VERSION,
    type: "ready",
    token: config.token,
    url: location.href,
  };
  dashboard.postMessage(ready, config.origin);
}

boot();
