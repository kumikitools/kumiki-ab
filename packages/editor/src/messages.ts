// The postMessage contract between the in-page overlay and the dashboard
// (ARCH §9.7, resolved 2026-06-21). The overlay runs on the user's REAL site
// (a different origin than the dashboard); the two talk over `window.opener`
// postMessage. Every message carries:
//   - `kumiki: "editor"` + `v` — namespace + version, so unrelated postMessages
//     (and future versions) are ignored.
//   - `token` — the one-time session token the dashboard minted and handed to
//     the bookmarklet, echoed back so a drive-by page can't inject `changes[]`.
// The receiver ALSO checks `event.origin` against its own origin; the token is
// defence in depth, not the only check.
import type { Change } from "@kumikitools/schema";

export const KUMIKI_EDITOR = "editor" as const;
export const PROTOCOL_VERSION = 1 as const;

/** Overlay → dashboard: "I booted, here is the session I belong to." */
export interface ReadyMessage {
  kumiki: typeof KUMIKI_EDITOR;
  v: typeof PROTOCOL_VERSION;
  type: "ready";
  token: string;
  /** The page the user is editing, for display + the testʼs urlMatch hint. */
  url: string;
}

/** Dashboard → overlay: ack + (optional) the changes already on the variant. */
export interface InitMessage {
  kumiki: typeof KUMIKI_EDITOR;
  v: typeof PROTOCOL_VERSION;
  type: "init";
  token: string;
  /** Pre-existing changes so the overlay can show/extend them. */
  changes: Change[];
}

/** Overlay → dashboard: the authored change set (sent on "Send to dashboard"). */
export interface ChangesMessage {
  kumiki: typeof KUMIKI_EDITOR;
  v: typeof PROTOCOL_VERSION;
  type: "changes";
  token: string;
  changes: Change[];
}

export type EditorMessage = ReadyMessage | InitMessage | ChangesMessage;

/** Narrow an untrusted postMessage payload to a versioned editor message. */
export function parseEditorMessage(data: unknown, token: string): EditorMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<EditorMessage>;
  if (m.kumiki !== KUMIKI_EDITOR || m.v !== PROTOCOL_VERSION) return null;
  if (m.token !== token) return null;
  if (m.type === "ready" || m.type === "init" || m.type === "changes") {
    return m as EditorMessage;
  }
  return null;
}
