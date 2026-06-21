import { beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/engine";
import { createBeacon } from "../src/beacon";
import type { KumikiConfig } from "@kumikitools/schema";

function hidingStyle(): HTMLElement | null {
  return document.getElementById("_kumiki_af");
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = `<h1 id="title">Original</h1>`;
  localStorage.clear();
  delete (window as any).gtag;
  delete (window as any).dataLayer;
});

const config: KumikiConfig = {
  tests: [
    {
      id: "t1",
      status: "applied",
      winner: "v1",
      variants: [
        { id: "control", weight: 1 },
        { id: "v1", weight: 1, changes: [{ selector: "#title", type: "text", value: "Winner" }] },
      ],
    },
  ],
};

describe("run", () => {
  it("applies the assigned variant and reveals the page", () => {
    const result = run(config, window, document);
    expect(document.querySelector("#title")!.textContent).toBe("Winner");
    // Anti-flicker style must be gone after a successful run.
    expect(hidingStyle()).toBeNull();
    expect(result.assignments).toEqual([{ testId: "t1", variantId: "v1" }]);
    expect(result.visitorId).toMatch(/.+/);
  });

  it("persists a sticky visitor id across runs", () => {
    const a = run(config, window, document);
    const b = run(config, window, document);
    expect(a.visitorId).toBe(b.visitorId);
  });

  it("emits a GA4 exposure event via gtag", () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;
    run(config, window, document);
    expect(gtag).toHaveBeenCalledWith("event", "experiment_impression", {
      experiment_id: "t1",
      variant_id: "v1",
    });
  });

  it("falls back to dataLayer when gtag is absent", () => {
    run(config, window, document);
    expect((window as any).dataLayer).toEqual([
      { event: "experiment_impression", experiment_id: "t1", variant_id: "v1" },
    ]);
  });

  it("fails open: reveals the page even if applying a variant throws", () => {
    // Force querySelectorAll to throw mid-run.
    const spy = vi.spyOn(document, "querySelectorAll").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => run(config, window, document)).not.toThrow();
    expect(hidingStyle()).toBeNull();
    spy.mockRestore();
  });

  it("skips excluded/stopped tests without assignment", () => {
    const stopped: KumikiConfig = {
      tests: [{ id: "s", status: "stopped", variants: [{ id: "c", weight: 1 }] }],
    };
    const result = run(stopped, window, document);
    expect(result.assignments).toEqual([]);
    expect(hidingStyle()).toBeNull();
  });

  it("emits a self-collected exposure beacon alongside GA4 when beacon is provided", () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const send = (u: string, b: string) => calls.push({ url: u, body: JSON.parse(b) });
    const beacon = createBeacon(window, "site1", "https://api.kumiki.com", send);

    run(config, window, document, beacon);
    beacon.flush();

    expect(calls).toHaveLength(1);
    const { events } = calls[0].body as { events: Array<{ type: string; testId: string; variantId: string }> };
    const exposure = events.find((e) => e.type === "exposure");
    expect(exposure).toBeDefined();
    expect(exposure!.testId).toBe("t1");
    expect(exposure!.variantId).toBe("v1");
  });

  it("run() without beacon does not throw (backward compat)", () => {
    expect(() => run(config, window, document)).not.toThrow();
  });

  it("honors URL targeting (jsdom href = localhost)", () => {
    const targeted: KumikiConfig = {
      tests: [
        {
          id: "match",
          status: "applied",
          winner: "v1",
          urlMatch: { include: [{ type: "contains", value: "localhost" }] },
          variants: [{ id: "v1", weight: 1, changes: [{ selector: "#title", type: "text", value: "Y" }] }],
        },
        {
          id: "nomatch",
          status: "applied",
          winner: "v1",
          urlMatch: { include: [{ type: "contains", value: "/never-here/" }] },
          variants: [{ id: "v1", weight: 1 }],
        },
      ],
    };
    const result = run(targeted, window, document);
    expect(result.assignments).toEqual([{ testId: "match", variantId: "v1" }]);
    expect(document.querySelector("#title")!.textContent).toBe("Y");
  });
});
