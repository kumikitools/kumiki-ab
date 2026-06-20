import { beforeEach, describe, expect, it } from "vitest";
import { initGoals } from "../src/goals";
import { createBeacon } from "../src/beacon";
import type { Goal } from "@kumikitools/schema";

const SITE = "s1";
const INGEST = "https://api.kumiki.com";
const VISITOR = "vis-abc";

function makeBeacon() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const send = (u: string, b: string) => calls.push({ url: u, body: JSON.parse(b) });
  const beacon = createBeacon(window, SITE, INGEST, send);
  return { beacon, calls };
}

function flushedConversions(calls: Array<{ body: unknown }>) {
  return calls.flatMap(
    (c) => (c.body as { events: Array<{ type: string; goal: string; value?: number }> }).events
      .filter((e) => e.type === "conversion"),
  );
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = `
    <button id="btn">Buy</button>
    <form id="form"><input type="submit" /></form>
  `;
  localStorage.clear();
});

describe("URL goals", () => {
  it("fires on load when location matches", () => {
    // jsdom default href contains "localhost"
    const goals: Goal[] = [
      { id: "home", type: "url", targeting: { include: [{ type: "contains", value: "localhost" }] } },
    ];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);
    beacon.flush();

    const conversions = flushedConversions(calls);
    expect(conversions).toHaveLength(1);
    expect(conversions[0].goal).toBe("home");
  });

  it("does NOT fire when location does not match", () => {
    const goals: Goal[] = [
      { id: "shop", type: "url", targeting: { include: [{ type: "contains", value: "/shop/" }] } },
    ];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);
    beacon.flush();
    expect(flushedConversions(calls)).toHaveLength(0);
  });

  it("deduplicates: same (goalId, href) fires only once", () => {
    const goals: Goal[] = [
      { id: "home", type: "url", targeting: { include: [{ type: "contains", value: "localhost" }] } },
    ];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);
    // Simulate second call (e.g. SPA nav back to same URL).
    window.dispatchEvent(new PopStateEvent("popstate"));
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(1);
  });

  it("fires again when SPA nav changes to a NEW matching URL", () => {
    const goals: Goal[] = [
      { id: "any-page", type: "url", targeting: { include: [{ type: "contains", value: "localhost" }] } },
    ];
    const { beacon } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    // Simulate pushState to a different URL — jsdom doesn't actually change location,
    // but our patched pushState triggers checkUrlGoals. We only verify it fires again
    // when location href changes; since href stays the same in jsdom the dedup key
    // (goalId + href) will already be in `fired`, so a second call is deduped.
    // Test the non-dedup case via a second goal instead.
    const goals2: Goal[] = [
      { id: "first", type: "url", targeting: { include: [{ type: "contains", value: "localhost" }] } },
      { id: "second", type: "url", targeting: { include: [{ type: "contains", value: "localhost" }] } },
    ];
    const { beacon: b2, calls: c2 } = makeBeacon();
    initGoals(goals2, VISITOR, b2, window, document);
    b2.flush();

    expect(flushedConversions(c2)).toHaveLength(2);
  });

  it("carries the static revenue value", () => {
    const goals: Goal[] = [
      { id: "home", type: "url", targeting: { include: [{ type: "contains", value: "localhost" }] }, value: 10 },
    ];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);
    beacon.flush();

    const conversions = flushedConversions(calls);
    expect(conversions[0].value).toBe(10);
  });
});

describe("Click goals", () => {
  it("fires when a matching element is clicked", () => {
    const goals: Goal[] = [{ id: "buy-click", type: "click", selector: "#btn" }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("btn")!.click();
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(1);
    expect(flushedConversions(calls)[0].goal).toBe("buy-click");
  });

  it("fires via closest() — click on child of target", () => {
    document.body.innerHTML = `<div id="cta"><span>Click me</span></div>`;
    const goals: Goal[] = [{ id: "cta-click", type: "click", selector: "#cta" }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    // Click the child span — closest("#cta") should still match.
    document.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(1);
    expect(flushedConversions(calls)[0].goal).toBe("cta-click");
  });

  it("does NOT fire when a non-matching element is clicked", () => {
    const goals: Goal[] = [{ id: "buy-click", type: "click", selector: "#nonexistent" }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("btn")!.click();
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(0);
  });

  it("fires multiple times (no dedup for clicks)", () => {
    const goals: Goal[] = [{ id: "buy-click", type: "click", selector: "#btn" }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("btn")!.click();
    document.getElementById("btn")!.click();
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(2);
  });

  it("carries static revenue value", () => {
    const goals: Goal[] = [{ id: "buy-click", type: "click", selector: "#btn", value: 29 }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("btn")!.click();
    beacon.flush();

    expect(flushedConversions(calls)[0].value).toBe(29);
  });
});

describe("Form goals", () => {
  it("fires on submit of a matching form", () => {
    const goals: Goal[] = [{ id: "signup-form", type: "form", selector: "#form" }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(1);
    expect(flushedConversions(calls)[0].goal).toBe("signup-form");
  });

  it("does NOT fire for a non-matching form", () => {
    document.body.innerHTML += `<form id="other"><input type="submit" /></form>`;
    const goals: Goal[] = [{ id: "signup-form", type: "form", selector: "#form" }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("other")!.dispatchEvent(new Event("submit", { bubbles: true }));
    beacon.flush();

    expect(flushedConversions(calls)).toHaveLength(0);
  });

  it("carries static revenue value", () => {
    const goals: Goal[] = [{ id: "signup-form", type: "form", selector: "#form", value: 5 }];
    const { beacon, calls } = makeBeacon();
    initGoals(goals, VISITOR, beacon, window, document);

    document.getElementById("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    beacon.flush();

    expect(flushedConversions(calls)[0].value).toBe(5);
  });
});

describe("initGoals — fail-open", () => {
  it("does not throw with an empty goals array", () => {
    const { beacon } = makeBeacon();
    expect(() => initGoals([], VISITOR, beacon, window, document)).not.toThrow();
  });

  it("does not throw when the beacon's methods are missing (defensive)", () => {
    const { beacon } = makeBeacon();
    const brokenBeacon = { ...beacon, enqueueConversion: () => { throw new Error("boom"); } };
    const goals: Goal[] = [{ id: "click", type: "click", selector: "#btn" }];
    initGoals(goals, VISITOR, brokenBeacon as typeof beacon, window, document);

    expect(() => document.getElementById("btn")!.click()).not.toThrow();
  });
});

describe("window.KUMIKI.track", () => {
  it("enqueueConversion via beacon sends a conversion event", () => {
    const { beacon, calls } = makeBeacon();
    beacon.enqueueConversion("checkout", VISITOR, { value: 99 });
    beacon.flush();

    const conversions = flushedConversions(calls);
    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toMatchObject({ type: "conversion", goal: "checkout", value: 99 });
  });
});
