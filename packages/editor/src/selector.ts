// Stability-ranked CSS selector generation (ARCH §9.6, resolved 2026-06-21).
//
// When the user clicks an element in the overlay, we must persist a selector
// into `changes[].selector`. The snippet applies it with `doc.querySelectorAll`
// to EVERY match (packages/snippet/src/apply.ts), so the selector must be a
// valid CSS selector and — usually — uniquely identify the clicked element.
//
// Strategy: emit the SHORTEST selector that is unique on the captured page,
// preferring stable hooks and falling back to structure only when nothing stable
// exists. Order of preference for a single element:
//   1. a stable `id`
//   2. a `data-*` test/semantic attribute (data-testid, data-test, data-qa, …)
//   3. a single human-meaningful, unique class
//   4. tag + a small combo of the above, scoped under the nearest stable ancestor
//   5. last resort: an `:nth-of-type` step path anchored at the nearest stable
//      ancestor (never a full path from <html>)
//
// Volatile tokens (framework-generated ids, hashed/CSS-module/utility classes)
// are skipped — they look unique but churn between deploys, which is exactly the
// brittleness we are avoiding.

/** A generated selector plus how many elements it matched on the live page. */
export interface SelectorResult {
  /** The CSS selector to persist into `changes[].selector`. */
  selector: string;
  /** Live match count at authoring time (1 = uniquely targets the picked element). */
  matchCount: number;
  /** How the selector was derived — surfaced in the overlay for transparency. */
  strategy: "id" | "data-attr" | "class" | "scoped" | "nth-path";
}

const VOLATILE_ID = /^(?:[0-9])|(?::r[0-9a-z]+:)|(?:[A-Za-z0-9_-]*[0-9a-f]{6,})/i;
const PREFERRED_DATA_ATTRS = [
  "data-testid",
  "data-test",
  "data-test-id",
  "data-qa",
  "data-cy",
  "data-track",
  "data-component",
  "data-name",
];
// Classes that are framework/util churn, not semantic hooks: CSS-module hashes
// (`Header_logo__a1b2c`), styled-components (`sc-bdVaJa`), emotion (`css-1q2w3e`),
// and bare hash atoms (a 6+ char token that mixes letters and digits, e.g.
// `x9f3a2bc`). Plain words — even long ones like `primary`/`header` — are NOT
// volatile (the earlier `^…{5,}$` branch wrongly flagged those).
const VOLATILE_CLASS =
  /__[a-z0-9]{4,}$|^sc-[a-z0-9]{4,}$|^css-[a-z0-9]{4,}$|^(?=.*[0-9])[a-z0-9]{6,}$/i;

function isVolatileId(id: string): boolean {
  return id === "" || VOLATILE_ID.test(id);
}

function isStableClass(cls: string): boolean {
  if (!cls || cls.length < 2) return false; // single-char classes aren't meaningful hooks
  if (VOLATILE_CLASS.test(cls)) return false;
  // Skip obvious utility classes (Tailwind-ish) — they never uniquely identify.
  if (/^(?:[mp][trblxy]?-|w-|h-|flex|grid|text-|bg-|border|rounded|gap-|items-|justify-)/.test(cls)) {
    return false;
  }
  return true;
}

/** CSS.escape with a tiny fallback for non-browser test environments. */
function esc(value: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  return value.replace(/([^a-zA-Z0-9_ -￿-])/g, "\\$1");
}

function countMatches(root: Document | Element, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return 0; // invalid selector → treat as no match so we don't emit it
  }
}

function tag(el: Element): string {
  return el.tagName.toLowerCase();
}

/** Stable classes on an element, in document order, de-duplicated. */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(isStableClass);
}

/** `:nth-of-type` step for `el` among its same-tag siblings (1-based). */
function nthOfType(el: Element): string {
  const t = tag(el);
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (tag(sib) === t) i++;
    sib = sib.previousElementSibling;
  }
  return `${t}:nth-of-type(${i})`;
}

/**
 * The nearest ancestor (or the element itself) that carries a stable anchor we
 * can scope under: a stable id or a preferred data-* attribute. Returns the
 * selector for that anchor, or null if none exists up to <body>.
 */
function nearestStableAnchor(el: Element, doc: Document): { node: Element; sel: string } | null {
  let node: Element | null = el;
  while (node && node !== doc.documentElement) {
    const id = node.getAttribute("id");
    if (id && !isVolatileId(id) && countMatches(doc, `#${esc(id)}`) === 1) {
      return { node, sel: `#${esc(id)}` };
    }
    for (const attr of PREFERRED_DATA_ATTRS) {
      const v = node.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${esc(v)}"]`;
        if (countMatches(doc, sel) === 1) return { node, sel };
      }
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Generate the best selector for `el` against its owner document. Always returns
 * a valid selector that matches `el`; `matchCount` tells the caller whether it is
 * unique (the overlay warns when it is not).
 */
export function generateSelector(el: Element): SelectorResult {
  const doc = el.ownerDocument;
  const t = tag(el);

  // 1. Stable, unique id.
  const id = el.getAttribute("id");
  if (id && !isVolatileId(id)) {
    const sel = `#${esc(id)}`;
    const n = countMatches(doc, sel);
    if (n === 1) return { selector: sel, matchCount: 1, strategy: "id" };
  }

  // 2. A preferred data-* attribute that is unique on its own.
  for (const attr of PREFERRED_DATA_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) {
      const sel = `[${attr}="${esc(v)}"]`;
      const n = countMatches(doc, sel);
      if (n === 1) return { selector: sel, matchCount: 1, strategy: "data-attr" };
      const scoped = `${t}${sel}`;
      if (countMatches(doc, scoped) === 1) {
        return { selector: scoped, matchCount: 1, strategy: "data-attr" };
      }
    }
  }

  // 3. A single stable class that is unique (optionally with the tag).
  const classes = stableClasses(el);
  for (const cls of classes) {
    const bare = `.${esc(cls)}`;
    if (countMatches(doc, bare) === 1) {
      return { selector: bare, matchCount: 1, strategy: "class" };
    }
    const withTag = `${t}.${esc(cls)}`;
    if (countMatches(doc, withTag) === 1) {
      return { selector: withTag, matchCount: 1, strategy: "class" };
    }
  }
  // 3b. A combination of stable classes (tag + all of them).
  if (classes.length > 1) {
    const combo = `${t}${classes.map((c) => `.${esc(c)}`).join("")}`;
    if (countMatches(doc, combo) === 1) {
      return { selector: combo, matchCount: 1, strategy: "class" };
    }
  }

  // 4. Scope a tag/class selector under the nearest stable ancestor.
  const anchor = nearestStableAnchor(el.parentElement ?? el, doc);
  if (anchor && anchor.node !== el) {
    const leaf = classes.length ? `${t}${classes.map((c) => `.${esc(c)}`).join("")}` : t;
    const scoped = `${anchor.sel} ${leaf}`;
    if (countMatches(doc, scoped) === 1) {
      return { selector: scoped, matchCount: 1, strategy: "scoped" };
    }
    // 5a. Scoped nth-of-type path from the anchor down to the element.
    const path = nthPathTo(el, anchor.node);
    if (path) {
      const scopedPath = `${anchor.sel} ${path}`;
      return {
        selector: scopedPath,
        matchCount: countMatches(doc, scopedPath),
        strategy: "nth-path",
      };
    }
  }

  // 5b. Last resort: a full nth-of-type path from <body>.
  const full = nthPathTo(el, doc.body);
  if (full) {
    const sel = `body ${full}`;
    return { selector: sel, matchCount: countMatches(doc, sel), strategy: "nth-path" };
  }

  // Degenerate fallback (e.g. <html>): the tag itself.
  return { selector: t, matchCount: countMatches(doc, t), strategy: "nth-path" };
}

/**
 * Build an `:nth-of-type` descendant path from (but excluding) `ancestor` down to
 * and including `el`. Returns null if `el` is not a descendant of `ancestor`.
 */
function nthPathTo(el: Element, ancestor: Element | null): string | null {
  if (!ancestor) return null;
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node !== ancestor) {
    steps.unshift(nthOfType(node));
    node = node.parentElement;
  }
  if (node !== ancestor) return null; // el was not under ancestor
  return steps.length ? steps.join(" > ") : null;
}
