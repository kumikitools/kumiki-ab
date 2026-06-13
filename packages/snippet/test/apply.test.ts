import { beforeEach, describe, expect, it } from "vitest";
import { applyChange, applyVariant } from "../src/apply";
import type { Variant } from "../src/types";

beforeEach(() => {
  document.body.innerHTML = `
    <h1 id="title">Original</h1>
    <p class="copy">a</p>
    <p class="copy">b</p>
    <a id="cta" href="/old" data-x="1">Buy</a>
    <div id="banner">x</div>
  `;
});

describe("applyChange", () => {
  it("sets text content on all matches", () => {
    const n = applyChange(document, { selector: ".copy", type: "text", value: "z" });
    expect(n).toBe(2);
    expect(Array.from(document.querySelectorAll(".copy")).every((e) => e.textContent === "z")).toBe(true);
  });

  it("sets innerHTML", () => {
    applyChange(document, { selector: "#title", type: "html", value: "<em>New</em>" });
    expect(document.querySelector("#title")!.innerHTML).toBe("<em>New</em>");
  });

  it("applies inline styles", () => {
    applyChange(document, { selector: "#title", type: "style", value: { color: "red", "font-size": "20px" } });
    const el = document.querySelector("#title") as HTMLElement;
    expect(el.style.color).toBe("red");
    expect(el.style.getPropertyValue("font-size")).toBe("20px");
  });

  it("sets and removes attributes", () => {
    applyChange(document, { selector: "#cta", type: "attr", value: { href: "/new", "data-x": "" } });
    const el = document.querySelector("#cta")!;
    expect(el.getAttribute("href")).toBe("/new");
    expect(el.hasAttribute("data-x")).toBe(false);
  });

  it("adds and removes classes", () => {
    applyChange(document, { selector: "#banner", type: "class", value: ["promo", "-x"] });
    const el = document.querySelector("#banner")!;
    expect(el.classList.contains("promo")).toBe(true);
  });

  it("hides elements with display:none !important", () => {
    applyChange(document, { selector: "#banner", type: "hide" });
    const el = document.querySelector("#banner") as HTMLElement;
    expect(el.style.getPropertyValue("display")).toBe("none");
  });

  it("removes elements from the DOM", () => {
    applyChange(document, { selector: "#banner", type: "remove" });
    expect(document.querySelector("#banner")).toBeNull();
  });

  it("returns 0 and does not throw on an invalid selector", () => {
    expect(applyChange(document, { selector: ">>bad", type: "text", value: "x" })).toBe(0);
  });

  it("returns 0 when nothing matches", () => {
    expect(applyChange(document, { selector: ".nope", type: "text", value: "x" })).toBe(0);
  });
});

describe("applyVariant", () => {
  it("applies every change in order", () => {
    const v: Variant = {
      id: "v1",
      weight: 1,
      changes: [
        { selector: "#title", type: "text", value: "New" },
        { selector: "#cta", type: "attr", value: { href: "/new" } },
      ],
    };
    applyVariant(document, v);
    expect(document.querySelector("#title")!.textContent).toBe("New");
    expect(document.querySelector("#cta")!.getAttribute("href")).toBe("/new");
  });

  it("is a no-op for control (no changes)", () => {
    const before = document.body.innerHTML;
    applyVariant(document, { id: "control", weight: 1 });
    expect(document.body.innerHTML).toBe(before);
  });
});
