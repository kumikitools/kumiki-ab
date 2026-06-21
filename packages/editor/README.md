# @kumikitools/editor — Kumiki A/B visual editor (F2)

The no-code way to author a variant's `changes[]` — **by clicking elements on
your real page** instead of typing JSON. It feeds the exact same
`{ selector, type, value }` contract the F1 dashboard already saves
(`@kumikitools/schema`); it adds no new API route and no second schema.

## Why a bookmarklet, not an iframe (ARCH §9.7)

Many sites — including production storefronts — send
`X-Frame-Options: SAMEORIGIN`, so the dashboard **cannot** iframe the live page.
So the picker is shipped as a **bookmarklet** that injects this bundle onto the
real page (a browser extension is a later UX upgrade on the same code). This:

- sidesteps X-Frame-Options / CSP **permanently** — it isn't framing anything;
- edits the **exact DOM the snippet runs against**, so generated selectors are
  verified to resolve in situ;
- is how Optimizely / VWO / old Google Optimize all ship their visual editors.

The dashboard `window.open`s the target (top-level nav, not blocked by XFO); the
overlay handshakes back over `window.opener` `postMessage` (origin + one-time
session token checked both ways) and posts the authored `changes[]`. If there is
no opener, the overlay offers **Copy JSON** to paste into the dashboard.

## Selector strategy (ARCH §9.6)

`generateSelector()` emits the **shortest selector unique on the page**,
preferring stable hooks and falling back to structure only when nothing stable
exists: `id → data-* → meaningful class → scoped tag combo → :nth-of-type at the
nearest stable ancestor`. Volatile tokens (hashed/CSS-module/utility classes,
framework-generated ids) are skipped. The overlay shows the live match-count and
warns when a selector matches more than one element (the snippet applies each
change to **every** match).

## Guardrail (ARCH §3)

`checkGuardrail()` refuses to pick checkout/payment elements — by URL
(`/checkout`, `/cart`, 決済/購入…), by attributes (card-number, cvc, stripe…), or
by being inside a payment form (`autocomplete="cc-*"`). Fail-safe: it over-blocks
rather than risk authoring a change on a payment element.

## Build / test

```bash
npm run build -w @kumikitools/editor   # esbuild → dist/editor.js (IIFE, ~5 KB gzip)
npm run test  -w @kumikitools/editor   # selector / guardrail / overlay / messages
npm run typecheck -w @kumikitools/editor
```

The dashboard serves the built bundle from `GET /editor` (embedded at build time
via its `embed-editor` prebuild — a Worker has no filesystem at runtime).
