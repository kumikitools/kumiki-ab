"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Change } from "@/lib/types";
import {
  KUMIKI_EDITOR,
  PROTOCOL_VERSION,
  parseEditorMessage,
  type InitMessage,
} from "@kumikitools/editor/messages";

/**
 * The dashboard half of the F2 visual editor (ARCH §9.7, resolved 2026-06-21).
 * We do NOT iframe the target site — many production sites send X-Frame-Options. Instead:
 *   1. mint a one-time session token,
 *   2. open the target page in a new tab (top-level nav, not blocked by XFO),
 *   3. the user clicks the Kumiki bookmarklet there → the overlay loads from
 *      THIS origin and handshakes back over `window.opener` postMessage,
 *   4. we send it the variant's current changes, and receive the edited set.
 * Both sides check origin + token. The picked `changes[]` replace this variant's
 * set via `onApply` — feeding the exact same `variantsJson` the F1 editor saves.
 */
export function VisualEditorLauncher({
  currentChanges,
  onApply,
}: {
  currentChanges: Change[];
  onApply: (changes: Change[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const tokenRef = useRef<string>("");
  const targetOriginRef = useRef<string>("");
  const winRef = useRef<Window | null>(null);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  // Keep the latest changes in a ref so the (stable) message handler always
  // sends the current set without re-subscribing on every keystroke.
  const changesRef = useRef<Change[]>(currentChanges);
  changesRef.current = currentChanges;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // Build the bookmarklet and set it imperatively — React strips `javascript:`
  // hrefs from JSX, but a ref-assigned href survives (the user drags it to their
  // bookmarks bar; it is never auto-navigated).
  useEffect(() => {
    if (!open || !bookmarkletRef.current) return;
    const token = tokenRef.current;
    const code =
      `javascript:(function(){window.__kumikiEditor={origin:${q(origin)},token:${q(token)}};` +
      `var s=document.createElement('script');s.src=${q(origin + "/editor")}+'?t='+Date.now();` +
      `s.async=true;document.body.appendChild(s);})();`;
    bookmarkletRef.current.href = code;
  }, [open, origin]);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      if (e.origin !== targetOriginRef.current) return;
      const m = parseEditorMessage(e.data, tokenRef.current);
      if (!m) return;
      if (m.type === "ready") {
        // Hand the overlay the changes already on this variant.
        const init: InitMessage = {
          kumiki: KUMIKI_EDITOR,
          v: PROTOCOL_VERSION,
          type: "init",
          token: tokenRef.current,
          changes: changesRef.current,
        };
        (e.source as Window | null)?.postMessage(init, targetOriginRef.current);
        setStatus("Connected — pick elements on your site, then “Send to dashboard”.");
      } else if (m.type === "changes") {
        onApply(m.changes);
        setStatus(`Received ${m.changes.length} change(s) from the editor.`);
      }
    },
    [onApply],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, onMessage]);

  function start() {
    tokenRef.current = mintToken();
    setStatus(null);
    setOpen(true);
  }

  function openSite() {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      setStatus("Enter the full URL of the page you want to edit (incl. https://).");
      return;
    }
    targetOriginRef.current = target.origin;
    winRef.current = window.open(target.href, "_blank", "noopener=no");
    setStatus("Opened your site. Click the Kumiki bookmarklet in that tab to start picking.");
  }

  return (
    <div className="kx-launcher">
      <button type="button" onClick={open ? () => setOpen(false) : start}>
        {open ? "Close visual editor" : "🎯 Pick visually"}
      </button>

      {open ? (
        <div className="kx-launch-panel">
          <ol>
            <li>
              Drag this to your bookmarks bar:{" "}
              {/* href set imperatively in the effect above */}
              <a ref={bookmarkletRef} className="kx-bookmarklet" href="#">
                Kumiki editor
              </a>
            </li>
            <li>
              <label>
                Page URL to edit{" "}
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-site.com/landing"
                />
              </label>{" "}
              <button type="button" onClick={openSite} disabled={!url}>
                Open my site
              </button>
            </li>
            <li>Click the bookmarklet in that tab, pick elements, then “Send to dashboard”.</li>
          </ol>
          {status ? <div className="kx-launch-status">{status}</div> : null}
          <p className="hint">
            No framing required — the editor runs on your real page, so it works even
            when the site blocks iframes (X-Frame-Options). If the tab can’t reach this
            dashboard, use the editor’s “Copy JSON” and paste into the Changes box.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** JSON-encode a string for safe embedding inside the javascript: bookmarklet. */
function q(s: string): string {
  return JSON.stringify(s);
}

/** A one-time session token. Uses crypto.randomUUID where available. */
function mintToken(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return `sess_${c.randomUUID()}`;
  return `sess_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
