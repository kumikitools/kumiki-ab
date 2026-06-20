import { beforeEach, describe, expect, it, vi } from "vitest";
import { installStub, STUB_HTML } from "../src/stub";
import { STYLE_ID, DEFAULT_TIMEOUT } from "../src/antiflicker";
import { hide } from "../src/antiflicker";

beforeEach(() => {
  document.head.innerHTML = "";
  vi.useRealTimers();
});

describe("installStub", () => {
  it("hides: injects a style with opacity:0 into head", () => {
    installStub(document);
    const el = document.getElementById(STYLE_ID);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("opacity:0");
  });

  it("idempotent: calling twice leaves exactly one #_kumiki_af", () => {
    installStub(document);
    installStub(document);
    expect(document.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
  });

  it("fail-open: timeout removes the hiding style", () => {
    vi.useFakeTimers();
    installStub(document, 100);
    expect(document.getElementById(STYLE_ID)).not.toBeNull();
    vi.advanceTimersByTime(101);
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("interop — snippet reveal() removes a stub-planted style", () => {
    installStub(document);
    expect(document.getElementById(STYLE_ID)).not.toBeNull();
    const af = hide(document); // hide() reuses the existing element (idempotent)
    expect(document.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
    af.reveal();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("interop — hide() reuses stub element, no duplicate", () => {
    installStub(document);
    hide(document);
    expect(document.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
  });
});

describe("STUB_HTML", () => {
  it("contains STYLE_ID in the style tag", () => {
    expect(STUB_HTML).toContain(`id="${STYLE_ID}"`);
  });

  it("contains the timeout value", () => {
    expect(STUB_HTML).toContain(String(DEFAULT_TIMEOUT));
  });

  it("contains opacity:0 rule", () => {
    expect(STUB_HTML).toContain("opacity:0");
  });

  it("contains both a <style> and a <script> tag", () => {
    expect(STUB_HTML).toMatch(/<style/);
    expect(STUB_HTML).toMatch(/<script/);
  });
});
