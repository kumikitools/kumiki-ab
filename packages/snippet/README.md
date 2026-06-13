# @kumikitools/snippet

The Kumiki A/B client snippet — the lightweight JS that runs in your page
`<head>` and applies experiment variants before first paint.

**~1.8 KB gzipped. No dependencies. Fail-open by design.**

## What it does

- **Config-driven DOM swap** — apply text / HTML / style / attribute / class /
  hide / remove changes by CSS selector.
- **Sticky bucketing** — a visitor always sees the same variant
  (deterministic `cyrb53(visitorId + testId)` hash; visitor id persisted in
  `localStorage`).
- **Anti-flicker** — hides `<body>` (opacity) until variants apply, so the
  original never flashes (FOOC).
- **Fail-open** — any error, anywhere, reveals the page with original content.
  A hard timeout guarantees the page is never left hidden.
- **GA4 exposure** — emits an `experiment_impression` event (gtag or dataLayer)
  so results are analysed from GA4, not a proprietary tracker.
- **Winning-pattern apply** — a test with `status: "applied"` serves the winner
  to 100% of traffic. This is the free hero feature.

## Usage

### Inline config (zero-flicker, recommended)

```html
<script>
  window.KUMIKI_CONFIG = {
    tests: [{
      id: "hero-headline",
      status: "running",
      variants: [
        { id: "control", weight: 1 },
        { id: "v1", weight: 1, changes: [
          { selector: "#headline", type: "text", value: "New headline" }
        ]}
      ]
    }]
  };
</script>
<script src="https://.../kumiki.min.js"></script>
```

### Fetched config (from the Workers API)

```html
<script src="https://.../kumiki.min.js" data-config-url="https://api.example.com/config/SITE_ID"></script>
```

The snippet hides synchronously, fetches, applies, then reveals.

## Config schema

See [`src/types.ts`](src/types.ts) — `KumikiConfig` is the single contract
shared with the Workers API, MCP server, and dashboard.

## Develop

```bash
npm install
npm test          # vitest + jsdom
npm run typecheck
npm run build     # → dist/kumiki.min.js
```

Open [`example/index.html`](example/index.html) in a browser for a live demo.

## License

MIT
