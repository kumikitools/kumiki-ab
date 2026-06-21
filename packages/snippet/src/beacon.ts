// Self-collected event beacon (D3). Batches exposure + conversion events and
// flushes them to the ingestion endpoint (POST /v1/e/:siteId). Design mirrors
// ga4.ts: fail-open, never throws into the page.
//
// Flush triggers: visibilitychange→hidden, pagehide (navigation/tab close), and
// a short debounce after the last enqueue. Events split at MAX_EVENTS_PER_BATCH.
// Each event carries a fresh idempotency key so retried beacons are deduped by
// the receiver (§3b).
import type { KumikiEvent } from "@kumikitools/schema";
import { MAX_EVENTS_PER_BATCH } from "@kumikitools/schema";

export interface Beacon {
  enqueueExposure(testId: string, variantId: string, visitorId: string): void;
  enqueueConversion(goalId: string, visitorId: string, opts?: { value?: number }): void;
  /** Flush immediately — exposed for tests and the pagehide/visibilitychange hooks. */
  flush(): void;
}

function randomKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID (old Safari, jsdom config).
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

type Sender = (url: string, body: string) => void;

function defaultSender(win: Window): Sender {
  return (url, body) => {
    try {
      const nav = win.navigator as Navigator & { sendBeacon?: (url: string, data: Blob) => boolean };
      if (typeof nav?.sendBeacon === "function") {
        nav.sendBeacon(url, new Blob([body], { type: "application/json" }));
        return;
      }
    } catch {}
    try {
      (win.fetch as typeof fetch)(url, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
        credentials: "omit",
      });
    } catch {}
  };
}

/**
 * Factory for the self-collected event beacon. `_sender` is a test-only hook
 * that replaces sendBeacon/fetch; omit in production.
 */
export function createBeacon(
  win: Window,
  siteId: string,
  ingestUrl: string,
  _sender?: Sender,
): Beacon {
  const url = `${ingestUrl}/v1/e/${siteId}`;
  const send = _sender ?? defaultSender(win);
  const queue: KumikiEvent[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (queue.length === 0) return;
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, MAX_EVENTS_PER_BATCH);
        send(url, JSON.stringify({ events: batch }));
      }
    } catch {}
  }

  function scheduleDebounce(): void {
    if (debounceTimer !== undefined) return;
    debounceTimer = setTimeout(flush, 2000);
  }

  function enqueue(event: KumikiEvent): void {
    try {
      queue.push(event);
      scheduleDebounce();
    } catch {}
  }

  try {
    win.addEventListener("visibilitychange", () => {
      try {
        if ((win.document as Document).visibilityState === "hidden") flush();
      } catch {}
    });
    win.addEventListener("pagehide", flush);
  } catch {}

  return {
    enqueueExposure(testId, variantId, visitorId) {
      try {
        enqueue({
          type: "exposure",
          key: randomKey(),
          ts: Date.now(),
          visitorId,
          testId,
          variantId,
        });
      } catch {}
    },
    enqueueConversion(goalId, visitorId, opts) {
      try {
        enqueue({
          type: "conversion",
          key: randomKey(),
          ts: Date.now(),
          visitorId,
          goal: goalId,
          ...(opts?.value !== undefined ? { value: opts.value } : {}),
        });
      } catch {}
    },
    flush,
  };
}
