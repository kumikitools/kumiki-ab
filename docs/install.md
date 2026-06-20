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

## Conversions

Coming soon. Conversion tracking — declarative goals (URL match, click, form submit),
`kumiki.track`, and GTM integration — is in active development.
