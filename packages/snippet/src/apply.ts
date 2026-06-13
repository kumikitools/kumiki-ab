// DOM mutation engine. Each Change is applied to every element matching its
// selector. Individual change failures are swallowed so one bad selector can't
// take down the rest of a variant (the engine layer adds page-level fail-open).
import type { Change, Variant } from "./types";

function applyOne(el: Element, change: Change): void {
  const { type, value } = change;
  switch (type) {
    case "text":
      el.textContent = String(value ?? "");
      break;
    case "html":
      el.innerHTML = String(value ?? "");
      break;
    case "style":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const style = (el as HTMLElement).style;
        for (const [prop, v] of Object.entries(value)) {
          style.setProperty(prop, String(v));
        }
      }
      break;
    case "attr":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [name, v] of Object.entries(value)) {
          if (v === null || v === undefined || v === "") el.removeAttribute(name);
          else el.setAttribute(name, String(v));
        }
      }
      break;
    case "class":
      if (Array.isArray(value)) {
        for (const cls of value) {
          // "-foo" removes, "foo" adds.
          if (typeof cls !== "string") continue;
          if (cls.startsWith("-")) el.classList.remove(cls.slice(1));
          else el.classList.add(cls);
        }
      }
      break;
    case "hide":
      (el as HTMLElement).style.setProperty("display", "none", "important");
      break;
    case "remove":
      el.parentNode?.removeChild(el);
      break;
  }
}

/** Apply a single change to all matching elements. Returns matched count. */
export function applyChange(doc: Document, change: Change): number {
  let matched = 0;
  let nodes: Element[];
  try {
    nodes = Array.from(doc.querySelectorAll(change.selector));
  } catch {
    // Invalid selector — skip this change, keep the rest of the variant.
    return 0;
  }
  for (const el of nodes) {
    try {
      applyOne(el, change);
      matched++;
    } catch {
      // Per-element failure is isolated.
    }
  }
  return matched;
}

/** Apply every change in a variant. Control (no changes) is a no-op. */
export function applyVariant(doc: Document, variant: Variant): void {
  for (const change of variant.changes ?? []) {
    applyChange(doc, change);
  }
}
