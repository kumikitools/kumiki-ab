// §9.6 selector strategy: stability-ranked, unique-on-capture, nth-path only as
// last resort. These tests pin the preference order and the brittleness we are
// avoiding (no full path from <html> when a stable hook exists).
import { generateSelector } from "../src/selector";

function mount(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

function pick(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`test fixture missing ${selector}`);
  return el;
}

describe("generateSelector — preference order", () => {
  it("prefers a stable, unique id", () => {
    mount(`<div id="hero"><h1 class="t">Hi</h1></div>`);
    const r = generateSelector(pick("h1"));
    // h1 has no id of its own → it should be scoped under #hero, not a raw path.
    expect(r.strategy).toBe("scoped");
    expect(r.selector).toBe("#hero h1");
    expect(r.matchCount).toBe(1);
  });

  it("uses the element's own stable id when present", () => {
    mount(`<button id="cta-main">Buy</button>`);
    const r = generateSelector(pick("button"));
    expect(r).toMatchObject({ selector: "#cta-main", strategy: "id", matchCount: 1 });
  });

  it("skips volatile ids (numeric / hashed / framework :r0:)", () => {
    mount(`<div id="x9f3a2bc"><span class="label">A</span></div>`);
    const r = generateSelector(pick("span"));
    // The hashed wrapper id must NOT be used as an anchor.
    expect(r.selector).not.toContain("x9f3a2bc");
  });

  it("prefers a unique data-testid over classes", () => {
    mount(`<a data-testid="signup" class="btn primary">Go</a>`);
    const r = generateSelector(pick("a"));
    expect(r).toMatchObject({ selector: '[data-testid="signup"]', strategy: "data-attr" });
  });

  it("uses a unique stable class when there is no id/data hook", () => {
    mount(`<nav><a class="logo">Home</a><a class="menu">More</a></nav>`);
    const r = generateSelector(pick(".logo"));
    expect(r).toMatchObject({ selector: ".logo", strategy: "class" });
  });

  it("skips hashed / CSS-module / utility classes", () => {
    mount(`<div class="Header_logo__a1b2c flex mt-4"><img class="brand"></div>`);
    const r = generateSelector(pick("img"));
    expect(r.selector).toBe(".brand");
    expect(r.selector).not.toContain("Header_logo");
  });

  it("combines tag + classes when a single class is not unique", () => {
    mount(`<p class="note">one</p><span class="note">two</span>`);
    const r = generateSelector(pick("span.note"));
    expect(r.matchCount).toBe(1);
    expect(document.querySelectorAll(r.selector)).toHaveLength(1);
    expect(document.querySelector(r.selector)).toBe(pick("span.note"));
  });

  it("falls back to a scoped nth path only when nothing stable exists", () => {
    mount(`<section id="list"><ul><li>a</li><li>b</li><li>c</li></ul></section>`);
    const third = document.querySelectorAll("#list li")[2];
    const r = generateSelector(third);
    expect(r.strategy).toBe("nth-path");
    expect(r.selector).toContain("#list"); // anchored at the stable ancestor
    expect(r.selector).toContain("nth-of-type(3)");
    expect(document.querySelector(r.selector)).toBe(third);
  });

  it("never emits a full <html> path when a stable ancestor exists", () => {
    mount(`<main id="app"><div><div><b>deep</b></div></div></main>`);
    const r = generateSelector(pick("b"));
    expect(r.selector.startsWith("#app")).toBe(true);
    expect(r.selector).not.toContain("html");
  });

  it("always returns a selector that resolves to the picked element", () => {
    mount(`
      <header><div class="row"><span>x</span><span>y</span></div></header>
      <footer><div class="row"><span>z</span></div></footer>`);
    const target = document.querySelectorAll("header .row span")[1];
    const r = generateSelector(target);
    expect(document.querySelector(r.selector)).toBe(target);
  });
});
