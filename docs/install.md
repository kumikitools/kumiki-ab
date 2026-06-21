# Installing Kumiki A/B

Get from zero to a live, exposure-collecting A/B test in two steps.

---

## Step 1 — Deploy your backend (~5 min)

Kumiki runs on **your own Cloudflare account** — your data, your D1 database, zero
vendor lock-in.

### Option A — CLI (recommended)

```bash
npm create kumiki@latest ab
```

Then follow the printed next steps:

```bash
# 1. Create your D1 database
wrangler d1 create kumiki

# 2. Paste the returned database_id into wrangler.toml

# 3. Apply migrations and deploy
wrangler d1 migrations apply kumiki --remote
wrangler deploy
```

### Option B — Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kumikitools/kumiki-ab/tree/main/packages/api)

One click provisions the Worker + D1 in your Cloudflare account. Cloudflare reads
`packages/api/wrangler.toml`, which declares the `DB` D1 binding and the `kumiki`
database name. The `database_id` must be correctly set before the Worker can access
your database; the exact provisioning flow depends on Cloudflare's button setup at
deploy time.

### Option C — Agent-native (set up from Claude Code)

Claude Code can run the full backend setup from the terminal. Ask Claude:

> "Scaffold a Kumiki A/B backend with `npm create kumiki@latest ab`, create the D1
> database with `wrangler d1 create kumiki`, update `wrangler.toml` with the returned
> `database_id`, apply migrations with `wrangler d1 migrations apply kumiki --remote`,
> then deploy with `wrangler deploy`."

Claude runs these commands in the shell — this is terminal-based deployment, **not** the
MCP server.

Once deployed, add the Kumiki MCP server to your Claude Code config. **The MCP server
operates tests only** — create sites and tests, set traffic splits, read results, apply
the winning variant. It cannot deploy Workers or create D1 databases.

---

## Step 2 — Install the snippet

After deploying you have a Worker URL (e.g. `https://<your-worker>.workers.dev`)
and a `SITE_ID` for the site you created.

Choose the tier that fits your setup:

---

### Tier 1 — In-`<head>` one-liner *(recommended — zero flicker)*

```html
<script src="https://<your-worker>.workers.dev/s.js?site=SITE_ID"></script>
```

Place this in `<head>` **before any content scripts**.

`/s.js?site=SITE_ID` returns the snippet with your live config baked in — variants
apply synchronously before first paint, so there is no flash of original content (FOOC).

**Requires:** access to your page template or CMS theme.

---

### Tier 2 — GTM + anti-flicker stub *(near-zero flicker, no template access needed)*

If you can only deploy via Google Tag Manager, add **two things**:

**a) In `<head>` — paste this before the GTM snippet:**

```html
<style id="_kumiki_af">body{opacity:0 !important}</style><script>setTimeout(function(){var e=document.getElementById("_kumiki_af");if(e)e.parentNode.removeChild(e);},4000);</script>
```

This hides `<body>` synchronously before GTM loads. The snippet removes it the moment
variants apply; the 4 s timeout is the fail-open backstop (page always becomes
visible).

**b) In GTM — Custom HTML tag, trigger: *Initialization – All Pages*:**

```html
<script src="https://<your-worker>.workers.dev/s.js?site=SITE_ID"></script>
```

Firing on *Initialization – All Pages* loads kumiki as early as GTM permits.

**Trade-off:** a brief residual flicker window exists between page parse and GTM fire.
The anti-flicker stub eliminates visible FOOC for most users; very fast connections
may still catch the hide→reveal cycle.

---

### Tier 3 — Pure GTM tag *(simple — some flicker)*

Add a GTM Custom HTML tag with the same snippet URL, fired as early as possible:

```html
<script src="https://<your-worker>.workers.dev/s.js?site=SITE_ID"></script>
```

GTM loads asynchronously, so the original content may briefly paint before variants
apply. This is the known trade-off of all GTM-based A/B tools (why VWO and Optimizely
also recommend in-head install).

**Use when:** the tested content is below the fold, or visible flicker is acceptable
for your experiment.

---

## Step 3 — Mark conversions

The snippet captures exposures automatically. To count a conversion, call
`window.KUMIKI.track` on the goal event — directly in your page code, or from a GTM tag
that reuses your existing GA4 trigger.

---

### a) JS API — `window.KUMIKI.track`

```js
if (window.KUMIKI && window.KUMIKI.track) {
  window.KUMIKI.track('purchase', { value: 4980 });
}
```

**Signature:** `window.KUMIKI.track(goal: string, opts?: { value?: number })`

| Parameter | Description |
|---|---|
| `goal` | A label for the conversion (e.g. `'purchase'`, `'signup'`). Any string is valid. |
| `value` | Optional revenue value (e.g. `4980` for ¥4,980). Omit if you do not track revenue. |

Always wrap the call with `if (window.KUMIKI && window.KUMIKI.track)` — the snippet
loads asynchronously and may not have run on every page.

**Best for:** precise conversions confirmed server-side (order callbacks, payment
success pages) or anywhere you need guaranteed call-time control.

---

### b) GTM conversion tag — reuse your existing GA4 trigger *(recommended combo)*

**In-`<head>` snippet for exposure + GTM tag for conversion** is the best setup for
teams already using GA4 via GTM: zero flicker on exposure, and conversions reuse
tagging you already maintain — no new triggers, no engineering ticket.

**Exposure (Step 2 Tier 1 — in `<head>`):**

```html
<script src="https://<your-worker>.workers.dev/s.js?site=SITE_ID"></script>
```

**Conversion — add this Custom HTML tag in GTM, bound to your existing GA4 purchase
/ conversion trigger:**

```html
<script>
  // Fires on your existing GA4 purchase / conversion trigger — no new trigger needed.
  // Replace {{Purchase Value}} with a GTM Data Layer Variable for your revenue amount,
  // or remove the `value` property if you do not track revenue.
  if (window.KUMIKI && window.KUMIKI.track) {
    window.KUMIKI.track('purchase', { value: {{Purchase Value}} });
  }
</script>
```

**To create the `{{Purchase Value}}` GTM variable:**

1. GTM → Variables → New → **Data Layer Variable**.
2. Data Layer Variable Name: `ecommerce.value` (adjust to match your push).
3. Save as `Purchase Value`.

The load guard means the tag is safe on any page where the snippet has not loaded.

---

### c) Declarative goals — no `track()` call needed

URL-visit, element-click, and form-submit goals fire conversion beacons **without any
page code**. Author them once at the site level, and the snippet evaluates them and
fires the beacon for you.

Each goal is one of three types — `url`, `click`, or `form` — each with an `id` and an
optional static `value`:

```jsonc
[
  { "id": "thanks",  "type": "url",   "targeting": { /* same shape as test page targeting */ } },
  { "id": "buy-btn", "type": "click", "selector": "#buy", "value": 4980 },
  { "id": "lead",    "type": "form",  "selector": "#signup-form" }
]
```

Save the set via the goals API or the MCP tool — both replace the whole goal set
atomically and purge the delivery cache:

- **API:** `PUT /v1/sites/:id/goals` with `{ "goals": [ … ] }` (read back with `GET`).
- **MCP (agent-native):** the `kumiki_set_goals` tool.

A point-and-click no-code UI for authoring these is still on the roadmap; for now use
the API/MCP above. Use `window.KUMIKI.track` (§a) for conversions you'd rather confirm
in code — e.g. server-verified purchases.

---

## How results count conversions

- **Variant-agnostic.** A conversion beacon carries a visitor ID and a goal label —
  not a variant ID. The variant is resolved at read time.
- **First-exposure attribution.** The variant a visitor was first assigned to is the
  one credited, regardless of how many subsequent exposures they had.
- **Conversion window.** Only conversions within W days of a visitor's first exposure
  are counted (default: 7 days, configurable per test via `conversion_window_days`).
