import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createBeacon } from "../src/beacon";
import { MAX_EVENTS_PER_BATCH } from "@kumikitools/schema";

const SITE = "s1";
const INGEST = "https://api.kumiki.com";
const URL_PATH = `${INGEST}/v1/e/${SITE}`;

function capturingSender(): { calls: Array<{ url: string; body: unknown }>; send: (u: string, b: string) => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  return {
    calls,
    send: (u, b) => calls.push({ url: u, body: JSON.parse(b) }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBeacon — flush triggers", () => {
  it("flushes exposure event on pagehide", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueExposure("t1", "v1", "visitor1");

    window.dispatchEvent(new Event("pagehide"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_PATH);
    const { events } = calls[0].body as { events: unknown[] };
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "exposure", testId: "t1", variantId: "v1", visitorId: "visitor1" });
  });

  it("flushes conversion event on visibilitychange→hidden", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueConversion("goal1", "visitor1", { value: 99 });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    window.dispatchEvent(new Event("visibilitychange"));

    expect(calls).toHaveLength(1);
    const { events } = calls[0].body as { events: unknown[] };
    expect(events[0]).toMatchObject({ type: "conversion", goal: "goal1", visitorId: "visitor1", value: 99 });

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("does NOT flush on visibilitychange→visible", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueExposure("t1", "v1", "visitor1");

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    window.dispatchEvent(new Event("visibilitychange"));

    expect(calls).toHaveLength(0);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("flushes via debounce after 2 s", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueExposure("t1", "v1", "visitor1");

    expect(calls).toHaveLength(0); // not yet

    vi.advanceTimersByTime(2000);

    expect(calls).toHaveLength(1);
  });

  it("explicit flush() sends immediately and clears the queue", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueExposure("t1", "v1", "visitor1");
    beacon.flush();
    expect(calls).toHaveLength(1);
    // Second flush is a no-op (queue empty).
    beacon.flush();
    expect(calls).toHaveLength(1);
  });
});

describe("createBeacon — idempotency keys", () => {
  it("each event gets a unique idempotency key", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueExposure("t1", "v1", "visitor1");
    beacon.enqueueExposure("t2", "v2", "visitor1");
    beacon.enqueueConversion("goal1", "visitor1");
    beacon.flush();

    const { events } = calls[0].body as { events: Array<{ key: string }> };
    const keys = events.map((e) => e.key);
    expect(new Set(keys).size).toBe(3); // all unique
  });
});

describe("createBeacon — batching", () => {
  it("splits into multiple batches at MAX_EVENTS_PER_BATCH", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);

    for (let i = 0; i < MAX_EVENTS_PER_BATCH + 5; i++) {
      beacon.enqueueConversion(`goal${i}`, "visitor1");
    }
    beacon.flush();

    expect(calls).toHaveLength(2);
    const first = calls[0].body as { events: unknown[] };
    const second = calls[1].body as { events: unknown[] };
    expect(first.events).toHaveLength(MAX_EVENTS_PER_BATCH);
    expect(second.events).toHaveLength(5);
  });
});

describe("createBeacon — fail-open", () => {
  it("does not throw when sendBeacon and fetch are absent", () => {
    // No _sender — falls back to real navigator/fetch; but we ensure no throw.
    const origSendBeacon = (window.navigator as { sendBeacon?: unknown }).sendBeacon;
    const origFetch = window.fetch;
    delete (window.navigator as { sendBeacon?: unknown }).sendBeacon;
    (window as { fetch?: unknown }).fetch = undefined;

    const beacon = createBeacon(window, SITE, INGEST);
    expect(() => {
      beacon.enqueueExposure("t1", "v1", "visitor1");
      window.dispatchEvent(new Event("pagehide"));
    }).not.toThrow();

    (window.navigator as { sendBeacon?: unknown }).sendBeacon = origSendBeacon;
    (window as { fetch?: unknown }).fetch = origFetch;
  });

  it("carries the optional revenue value on conversions", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueConversion("purchase", "visitor1", { value: 49.99 });
    beacon.flush();
    const { events } = calls[0].body as { events: Array<{ value?: number }> };
    expect(events[0].value).toBe(49.99);
  });

  it("omits the value field when not provided", () => {
    const { calls, send } = capturingSender();
    const beacon = createBeacon(window, SITE, INGEST, send);
    beacon.enqueueConversion("signup", "visitor1");
    beacon.flush();
    const { events } = calls[0].body as { events: Array<{ value?: number }> };
    expect("value" in events[0]).toBe(false);
  });
});
