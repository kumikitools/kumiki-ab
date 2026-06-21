import { beforeEach, describe, expect, it, vi } from "vitest";
import { hide } from "../src/antiflicker";

beforeEach(() => {
  document.head.innerHTML = "";
  vi.useRealTimers();
});

describe("hide", () => {
  it("injects a single hiding style and removes it on reveal", () => {
    const af = hide(document, 4000);
    expect(document.getElementById("_kumiki_af")).not.toBeNull();
    expect(document.getElementById("_kumiki_af")!.textContent).toContain("opacity:0");
    af.reveal();
    expect(document.getElementById("_kumiki_af")).toBeNull();
  });

  it("is idempotent — two hides do not create two styles", () => {
    hide(document, 4000);
    hide(document, 4000);
    expect(document.querySelectorAll("#_kumiki_af").length).toBe(1);
  });

  it("auto-reveals after the timeout (fail-open)", () => {
    vi.useFakeTimers();
    hide(document, 100);
    expect(document.getElementById("_kumiki_af")).not.toBeNull();
    vi.advanceTimersByTime(101);
    expect(document.getElementById("_kumiki_af")).toBeNull();
  });

  it("reveal is safe to call twice", () => {
    const af = hide(document, 4000);
    af.reveal();
    expect(() => af.reveal()).not.toThrow();
  });
});
