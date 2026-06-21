// The in-page overlay UI (ARCH §9.7). Runs on the user's REAL page (injected by
// the bookmarklet), so it must not collide with the host page's CSS or markup —
// the panel lives in a Shadow DOM, and the hover highlight is a single fixed
// element we own. The overlay's job: let the user point at an element, author one
// Change against it (type + value), preview the effect live, and accumulate a
// changes[] array that index.ts ships back to the dashboard.
import type { Change, ChangeType } from "@kumikitools/schema";
import { generateSelector } from "./selector";
import { checkGuardrail } from "./guardrail";

export interface OverlayOptions {
  /** Changes already on the variant (so the user extends rather than restarts). */
  initialChanges: Change[];
  /** Whether a dashboard window is connected (enables "Send to dashboard"). */
  hasDashboard: boolean;
  /** Called when the user sends the change set back to the dashboard. */
  onSend: (changes: Change[]) => void;
}

const CHANGE_TYPES: ChangeType[] = ["text", "html", "style", "attr", "class", "hide", "remove"];

export class Overlay {
  private changes: Change[];
  private picking = true;
  private hovered: Element | null = null;
  private selected: Element | null = null;
  private host!: HTMLElement;
  private root!: ShadowRoot;
  private highlight!: HTMLElement;
  private panel!: HTMLElement;

  constructor(private readonly opts: OverlayOptions) {
    this.changes = [...opts.initialChanges];
  }

  mount(): void {
    this.host = document.createElement("div");
    this.host.id = "kumiki-editor-root";
    this.host.style.cssText = "all:initial";
    this.root = this.host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(this.host);

    this.highlight = document.createElement("div");
    this.panel = document.createElement("div");
    this.root.appendChild(this.styleEl());
    this.root.appendChild(this.highlight);
    this.root.appendChild(this.panel);
    this.highlight.className = "kx-highlight";

    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("keydown", this.onKey, true);
    this.render();
  }

  destroy(): void {
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("keydown", this.onKey, true);
    this.host.remove();
  }

  // ── pointer / picking ──────────────────────────────────────────────────────

  private isOurs(el: EventTarget | null): boolean {
    return el instanceof Node && this.host.contains(el as Node);
  }

  private onMove = (e: MouseEvent): void => {
    if (!this.picking || this.isOurs(e.target)) return;
    const el = e.target as Element | null;
    if (!el || el === this.hovered) return;
    this.hovered = el;
    this.positionHighlight(el);
  };

  private onClick = (e: MouseEvent): void => {
    if (this.isOurs(e.target)) return; // clicks inside our panel are normal
    if (!this.picking) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target as Element;
    const verdict = checkGuardrail(el, location.href);
    if (verdict.blocked) {
      this.flashBlocked(verdict.reason ?? "Blocked.");
      return;
    }
    this.selected = el;
    this.picking = false;
    this.positionHighlight(el);
    this.render();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.selected = null;
      this.picking = true;
      this.render();
    }
  };

  private positionHighlight(el: Element): void {
    const r = el.getBoundingClientRect();
    const h = this.highlight.style;
    h.display = "block";
    h.top = `${r.top}px`;
    h.left = `${r.left}px`;
    h.width = `${r.width}px`;
    h.height = `${r.height}px`;
  }

  // ── authoring + preview ─────────────────────────────────────────────────────

  /** Parse the type-specific value input into a Change.value, or null if empty. */
  private buildChange(type: ChangeType, raw: string): Change | null {
    if (!this.selected) return null;
    const selector = generateSelector(this.selected).selector;
    switch (type) {
      case "hide":
      case "remove":
        return { selector, type };
      case "class":
        return { selector, type, value: raw.split(/\s+/).filter(Boolean) };
      case "style":
      case "attr": {
        // "prop: value" pairs, one per line.
        const obj: Record<string, string> = {};
        for (const line of raw.split("\n")) {
          const i = line.indexOf(":");
          if (i === -1) continue;
          const k = line.slice(0, i).trim();
          if (k) obj[k] = line.slice(i + 1).trim();
        }
        return { selector, type, value: obj };
      }
      default: // text | html
        return { selector, type, value: raw };
    }
  }

  /** Live preview so the user sees the change on their real page immediately. */
  private preview(change: Change): void {
    let nodes: Element[];
    try {
      nodes = Array.from(document.querySelectorAll(change.selector));
    } catch {
      return;
    }
    for (const el of nodes) this.applyPreview(el, change);
  }

  // Mirrors packages/snippet/src/apply.ts (applyOne) for author-time feedback
  // ONLY — the snippet remains the runtime authority. Kept in sync deliberately.
  private applyPreview(el: Element, change: Change): void {
    const { type, value } = change;
    const h = el as HTMLElement;
    if (type === "text") el.textContent = String(value ?? "");
    else if (type === "html") el.innerHTML = String(value ?? "");
    else if (type === "hide") h.style.setProperty("display", "none", "important");
    else if (type === "remove") el.parentNode?.removeChild(el);
    else if (type === "style" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [p, v] of Object.entries(value)) h.style.setProperty(p, String(v));
    } else if (type === "attr" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [n, v] of Object.entries(value)) {
        if (v === "" || v == null) el.removeAttribute(n);
        else el.setAttribute(n, String(v));
      }
    } else if (type === "class" && Array.isArray(value)) {
      for (const c of value) {
        if (typeof c !== "string") continue;
        if (c.startsWith("-")) el.classList.remove(c.slice(1));
        else el.classList.add(c);
      }
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────

  private render(): void {
    this.panel.className = "kx-panel";
    this.panel.innerHTML = "";
    this.panel.appendChild(this.headerRow());
    if (this.selected) this.panel.appendChild(this.authoringRow());
    else this.panel.appendChild(hint("Click any element to edit it. Esc to deselect."));
    this.panel.appendChild(this.changesList());
    this.panel.appendChild(this.footerRow());
  }

  private headerRow(): HTMLElement {
    const row = div("kx-header");
    row.appendChild(span("kx-title", "Kumiki visual editor"));
    const pick = button(this.picking ? "Picking…" : "Pick element", () => {
      this.picking = true;
      this.selected = null;
      this.render();
    });
    pick.className = this.picking ? "kx-btn kx-active" : "kx-btn";
    row.appendChild(pick);
    return row;
  }

  private authoringRow(): HTMLElement {
    const wrap = div("kx-author");
    const sel = generateSelector(this.selected as Element);
    wrap.appendChild(code(sel.selector));
    if (sel.matchCount !== 1) {
      wrap.appendChild(warn(`⚠ matches ${sel.matchCount} elements — this change applies to all of them.`));
    }

    const typeSel = document.createElement("select");
    typeSel.className = "kx-input";
    for (const t of CHANGE_TYPES) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      typeSel.appendChild(o);
    }

    const valueInput = document.createElement("textarea");
    valueInput.className = "kx-input kx-value";
    valueInput.rows = 2;
    const syncPlaceholder = () => {
      valueInput.placeholder = placeholderFor(typeSel.value as ChangeType);
      const noValue = typeSel.value === "hide" || typeSel.value === "remove";
      valueInput.style.display = noValue ? "none" : "block";
    };
    typeSel.onchange = syncPlaceholder;
    syncPlaceholder();

    wrap.appendChild(typeSel);
    wrap.appendChild(valueInput);
    wrap.appendChild(
      button("Add change", () => {
        const change = this.buildChange(typeSel.value as ChangeType, valueInput.value);
        if (!change) return;
        this.changes.push(change);
        this.preview(change);
        this.selected = null;
        this.picking = true;
        this.render();
      }),
    );
    return wrap;
  }

  private changesList(): HTMLElement {
    const list = div("kx-list");
    if (!this.changes.length) {
      list.appendChild(hint("No changes yet."));
      return list;
    }
    this.changes.forEach((c, i) => {
      const row = div("kx-item");
      row.appendChild(span("kx-itemtype", c.type));
      row.appendChild(code(c.selector));
      row.appendChild(
        button("✕", () => {
          this.changes.splice(i, 1);
          this.render();
        }),
      );
      list.appendChild(row);
    });
    return list;
  }

  private footerRow(): HTMLElement {
    const row = div("kx-footer");
    if (this.opts.hasDashboard) {
      const send = button(`Send ${this.changes.length} change(s) to dashboard`, () => {
        this.opts.onSend(this.changes);
      });
      send.className = "kx-btn kx-primary";
      row.appendChild(send);
    }
    row.appendChild(
      button("Copy JSON", () => {
        const json = JSON.stringify(this.changes, null, 2);
        void navigator.clipboard?.writeText(json).catch(() => undefined);
      }),
    );
    return row;
  }

  private flashBlocked(reason: string): void {
    const note = warn(reason);
    this.panel.insertBefore(note, this.panel.firstChild);
    setTimeout(() => note.remove(), 5000);
  }

  private styleEl(): HTMLStyleElement {
    const s = document.createElement("style");
    s.textContent = STYLE;
    return s;
  }
}

// ── tiny DOM helpers (no framework on the host page) ──────────────────────────

function div(cls: string): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  return el;
}
function span(cls: string, text: string): HTMLElement {
  const el = div(cls);
  el.textContent = text;
  return el;
}
function code(text: string): HTMLElement {
  const el = document.createElement("code");
  el.className = "kx-code";
  el.textContent = text;
  return el;
}
function hint(text: string): HTMLElement {
  return span("kx-hint", text);
}
function warn(text: string): HTMLElement {
  return span("kx-warn", text);
}
function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "kx-btn";
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function placeholderFor(type: ChangeType): string {
  switch (type) {
    case "text":
      return "New text content";
    case "html":
      return "<strong>New HTML</strong>";
    case "style":
      return "color: #fff\nbackground: #e11";
    case "attr":
      return "href: /sale\ntitle: Spring sale";
    case "class":
      return "promo featured -old-class   (prefix - to remove)";
    default:
      return "";
  }
}

const STYLE = `
:host { all: initial; }
.kx-highlight {
  position: fixed; z-index: 2147483646; pointer-events: none; display: none;
  border: 2px solid #4f46e5; background: rgba(79,70,229,.12); border-radius: 2px;
}
.kx-panel {
  position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: 320px;
  max-height: 80vh; overflow: auto; background: #fff; color: #111;
  font: 13px/1.45 -apple-system, system-ui, sans-serif; border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.28); padding: 12px;
}
.kx-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.kx-title { font-weight: 700; }
.kx-btn {
  font: inherit; padding: 5px 9px; border: 1px solid #d4d4d8; border-radius: 6px;
  background: #fafafa; cursor: pointer;
}
.kx-btn:hover { background: #f0f0f2; }
.kx-active { border-color:#4f46e5; color:#4f46e5; }
.kx-primary { background:#4f46e5; color:#fff; border-color:#4f46e5; }
.kx-author { border-top:1px solid #eee; padding-top:8px; margin-bottom:8px; display:grid; gap:6px; }
.kx-input { font: inherit; width: 100%; padding: 5px; border: 1px solid #d4d4d8; border-radius: 6px; box-sizing: border-box; }
.kx-value { font-family: ui-monospace, monospace; resize: vertical; }
.kx-code { font-family: ui-monospace, monospace; font-size: 12px; background:#f4f4f5; padding:2px 5px; border-radius:4px; word-break: break-all; }
.kx-hint { color:#71717a; font-size:12px; }
.kx-warn { display:block; color:#b45309; background:#fffbeb; border:1px solid #fde68a; padding:6px; border-radius:6px; font-size:12px; margin:4px 0; }
.kx-list { border-top:1px solid #eee; padding-top:8px; display:grid; gap:6px; }
.kx-item { display:flex; align-items:center; gap:6px; }
.kx-itemtype { font-weight:600; text-transform:uppercase; font-size:10px; color:#4f46e5; }
.kx-item .kx-code { flex:1; }
.kx-footer { border-top:1px solid #eee; margin-top:8px; padding-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
`;
