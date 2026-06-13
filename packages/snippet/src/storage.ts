// Visitor identity persistence. The visitorId is the sole input to sticky
// bucketing, so it must survive across page loads. Everything here is
// defensive: storage can throw (private mode, blocked cookies, quota) and the
// snippet must never break the page because of it.

const VISITOR_KEY = "_kumiki_vid";

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** localStorage-backed store that degrades to an in-memory map on failure. */
export function browserStorage(win: Window): Storage {
  let ls: globalThis.Storage | null = null;
  try {
    ls = win.localStorage;
    // Touch it — access alone can throw in some sandboxed iframes.
    const probe = "__kumiki_probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
  } catch {
    ls = null;
  }

  const mem = new Map<string, string>();
  return {
    get(key) {
      try {
        return ls ? ls.getItem(key) : (mem.get(key) ?? null);
      } catch {
        return mem.get(key) ?? null;
      }
    },
    set(key, value) {
      try {
        if (ls) ls.setItem(key, value);
        else mem.set(key, value);
      } catch {
        mem.set(key, value);
      }
    },
  };
}

/** A short, URL-safe random id. Not cryptographic — only needs to be unique. */
function randomId(): string {
  // 9-char base36 chunks, no Math.random dependency on crypto availability.
  const rnd = () => Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${rnd()}${rnd()}`.slice(0, 16);
}

/** Fetch the stable visitor id, minting and persisting one on first visit. */
export function getVisitorId(store: Storage): string {
  let id = store.get(VISITOR_KEY);
  if (!id) {
    id = randomId();
    store.set(VISITOR_KEY, id);
  }
  return id;
}
