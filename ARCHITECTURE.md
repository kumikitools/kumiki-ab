# Kumiki A/B — Phase 1 architecture & build plan

> Status: draft for review (2026-06-14). Anchored on the config schema already
> shipped in `packages/snippet/src/types.ts`. Strategy: `../../workspace/strategy.md` §3.3.

This plan covers what remains after the client snippet: **config delivery,
self-collected event ingestion, results (user-based Bayesian), the MCP server,
and the dashboard.** The snippet is built and tested; it pins the central
contract everything else serves.

---

## Decisions log (2026-06-14)

1. **Results are self-collected, not pulled from GA4.** kumiki collects its own
   exposure + conversion events keyed by its own bucket id, and computes results
   in its own store. GA4/dataLayer/webhook become **outbound** integrations
   (events flow *out*), not an inbound dependency. Reason: the GA4 Data API
   cannot do per-user conversion windows, suffers thresholding on small samples,
   has identity mismatch with our bucketing, and lags 24–48h. Pulling from it was
   secretly *more* work and *worse* data than collecting a narrow event set.
   - **⚠️ This reverses strategy §3.3 / README ("rely on GA4 / no proprietary
     tracking"). Update the strategy doc to match** (reframe the Optimize Next
     comparison as a strength: "you don't even need GA4 configured; if you have
     it, we feed it").
2. **Conversion model is user-based with a conversion window.** Unit = unique
   users first-exposed to a variant; numerator = those who convert within W days
   of *their own* first exposure, counting only post-exposure conversions.
   Reason: bucketing is sticky per-user, and beta-binomial assumes independent
   trials — sessions from one user are correlated and would inflate false
   positives.
3. **Scope guardrail — collect only what A/B needs.** Exposure, a conversion
   signal, an optional revenue value. Nothing else. General product/behavior
   analytics is a *separate future tool* (kumiki-analytics, strategy §3.4). If a
   second dimension creeps into the events table, stop. (strategy §8: half-baked
   tools kill the brand.)
4. **Free is a hard requirement, delivered two ways:** (a) *product-free* — MIT,
   every feature free at any scale including winner-apply (stronger than Optimize
   Next, which paywalls it); (b) *infra-free* — runs on the user's own Cloudflare
   free tier for most sites; ~$5/mo of *their own* Cloudflare at high traffic,
   never a kumiki charge. See §6.
5. **Install supports three tiers, GTM is first-class.** Direct in-`<head>`
   one-liner is the zero-flicker default, but GTM install is explicitly
   supported (most marketing teams have no dev-deploy access) and **conversions
   integrate with GA4 via GTM** — fire `kumiki.track` from the user's existing
   GA4 triggers so they reuse tagging they already have. The honest trade-off
   (GTM async → flicker) is documented, with an anti-flicker stub as mitigation.
   See §3.5.

---

## 0. The one contract: `KumikiConfig`

Everything exists to **produce, store, edit, deliver, or measure** one JSON
object — the `KumikiConfig` the snippet consumes:

```
KumikiConfig { tests: Test[], antiFlickerTimeout?, ga4? }
  Test    { id, status: running|applied|stopped, coverage?, variants[], winner?, urlMatch? }
  Variant { id, weight, changes?[] }
  Change  { selector, type, value }
  UrlTargeting { include?: UrlPattern[], exclude?: UrlPattern[] }   // exact|prefix|contains|wildcard|regex
```

- **Snippet** consumes it (done) and emits exposure/conversion events.
- **Delivery API** stores it (D1) and serves it (edge-cached) to the snippet.
- **Ingestion API** receives exposure/conversion events into the event store.
- **MCP** mutates config + reads results from Claude Code.
- **Dashboard / visual editor** generates `changes[]` visually.
- **Results** are computed from kumiki's own event store (not GA4).

Design rule: **the persisted config normalises this; the delivered config is
exactly this.** No second schema.

---

## 1. Components & stack (per strategy §3.3)

| Component | Tech | Package |
|---|---|---|
| Client snippet | TS → esbuild IIFE | `packages/snippet` ✅ |
| Config delivery + control API | Cloudflare Workers + Hono | `packages/api` |
| Event ingestion + results | Workers + Analytics Engine / D1 | `packages/api` |
| MCP server | TS MCP SDK, wraps the API | `packages/mcp` |
| Dashboard + visual editor | Next.js 15 + iframe editor | `packages/dashboard` |

Monorepo via npm workspaces (already set up).

---

## 2. Data model

Two stores with different shapes:

### 2a. Config store (D1 / SQLite) — normalised, low-volume, edited by humans/MCP
```sql
CREATE TABLE site (
  id            TEXT PRIMARY KEY,      -- public id used in the snippet URL
  name          TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL,         -- hashed write key (§5 auth)
  created_at    INTEGER NOT NULL
);

CREATE TABLE test (
  id            TEXT PRIMARY KEY,      -- == Test.id in config
  site_id       TEXT NOT NULL REFERENCES site(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL,         -- running|applied|stopped
  coverage      REAL DEFAULT 1,
  winner        TEXT,
  conversion_window_days INTEGER DEFAULT 7,  -- W for the user-based window
  url_match     TEXT,                  -- optional page targeting (open Q)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE variant (
  id            TEXT NOT NULL,
  test_id       TEXT NOT NULL REFERENCES test(id),
  weight        REAL NOT NULL DEFAULT 1,
  changes       TEXT NOT NULL DEFAULT '[]',  -- JSON Change[]
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (test_id, id)
);
```

### 2b. Event store — high-volume, append-only, the hot write path
Logical event shape (substrate is an open Q — Analytics Engine vs D1, §9):
```
exposure   { ts, site_id, test_id, variant_id, visitor_id }
conversion { ts, site_id, goal, visitor_id, value? }
```
- Keyed on the snippet's **own `visitor_id`** (the bucket id) → identity is
  consistent with assignment; no GA4-identity mismatch.
- Conversions are *not* tagged with a variant at write time — the join is done at
  read time per the window (a user's conversion is credited to whatever variant
  they were first exposed to, if within W days). Keeping conversion events
  variant-agnostic means one conversion event serves all concurrent tests.
- **Retention:** raw events kept long enough to cover the window + analysis
  (e.g. 90d), then rolled up. (open Q on substrate retention limits.)

---

## 3. API (Cloudflare Workers + Hono) — one Worker, three surfaces

### 3a. Delivery (public, cached) — the read hot path
```
GET /v1/config/:siteId  →  KumikiConfig (JSON)
GET /s.js?site=:siteId  →  snippet JS with config baked in (the install one-liner)
```
- Flattens site→tests→variants into the exact `KumikiConfig` shape.
- **`s.js` is the install endpoint:** returns the snippet with the site's config
  **inlined** into the response. One request, synchronous assignment → **zero
  flicker**, no separate config fetch. This is what the in-`<head>` one-liner
  points at (§3.5).
- Both are **CDN-cacheable** (`Cache-Control` + Cloudflare cache), purged on any
  config write. Config changes rarely → ~99.9% cache hit → **reads don't burn
  the Worker request budget** (key to staying free, §6). The raw `/config` JSON
  remains for the `data-config-url` fetch path and programmatic use.

### 3b. Ingestion (public write) — the event hot path
```
POST /v1/e/:siteId   body: batched exposures + conversions (beacon)
```
- Accepts **client-batched** events (one beacon per N events) → fewer writes.
- Writes to the event store. Idempotency key per event to dedup retries.
- Abuse/bot mitigation: per-site rate limit, optional sampling at high volume
  (sample exposures, keep all conversions — §6). No PII required; visitor_id is
  an opaque random id, not an identifier.

### 3c. Control (authenticated) — CRUD shared by MCP + dashboard
```
POST   /v1/sites                         create site
POST   /v1/sites/:id/tests               create test
GET    /v1/sites/:id/tests
GET    /v1/tests/:id
PATCH  /v1/tests/:id                      edit (status, coverage, window, name…)
PUT    /v1/tests/:id/variants            replace variants[] (editor saves)
POST   /v1/tests/:id/apply               { winner } → status=applied, 100% (hero)
POST   /v1/tests/:id/stop                kill switch (edge-purged)
GET    /v1/tests/:id/results             → user-based Bayesian summary (§4)
```
**The control surface IS the MCP surface** (README: "full REST coverage"). Every
route maps 1:1 to an MCP tool (§5).

Guardrails (strategy §8, the storefront is production): `apply`/going-`running` are
deliberate, logged, reversible; `stop` is the instant kill switch; never touch
checkout/payment selectors.

Validation: zod mirroring `types.ts` — consider a shared `packages/schema`.

---

## 3.5 Onboarding & install (the user's first 10 minutes)

Two setups, only one is a one-liner — be honest about both. GA4/Optimize Next are
pure one-liners because *Google hosts the backend*; kumiki's backend is the
**user's own** Cloudflare (the price of free + data sovereignty). We make that a
one *command*, not zero.

### Step 1 — Deploy backend (once, ~5 min)
- **"Deploy to Cloudflare" button** from the repo → provisions Worker + D1 in the
  user's account. Gold standard for self-host onboarding.
- **`npm create kumiki@latest ab`** → scaffold + `wrangler deploy` (CLI/AI-builder
  fit). Umbrella initializer + positional tool selector (`ab`); bare
  `npm create kumiki` opens a picker. Scales to the series (`kumiki analytics`).
- **Agent-native (marquee):** "set up kumiki from Claude Code" — the MCP angle
  turns deploy into a conversation. Lead marketing with this; it's the
  differentiator.
- Non-technical users are served by a *future optional hosted tier* (ladder §4),
  not self-host. Don't contort the self-host flow for them.

### Step 2 — Install snippet (three tiers)
Output of step 1 gives the user their Worker origin + `SITE_ID`.

1. **In-`<head>` one-liner — zero-flicker default (recommended):**
   ```html
   <script src="https://their-worker.workers.dev/s.js?site=SITE_ID"></script>
   ```
   `s.js` returns the snippet with config baked in (§3a) → synchronous → no FOOC.
   Needs template/dev access.

2. **GTM + anti-flicker stub — no dev deploy, near-zero flicker:**
   - Tiny stub (~3 lines) placed in `<head>` hides `<body>` immediately.
   - kumiki loaded as a GTM **Custom HTML tag** on *Initialization – All Pages*;
     it reveals once variants apply (snippet's hard-timeout reveal is the
     fail-open backstop).
   - Still needs that one in-head stub line, but no full template deploy.

3. **Pure GTM tag — acceptable, documented flicker:**
   - kumiki as a Custom HTML tag, fired as early as possible. GTM loads async, so
     the original can paint before the tag fires (FOOC). State this plainly; this
     is the known weakness of GTM-based A/B (why VWO/Optimizely/old Optimize all
     recommend in-head). Fine for low-risk/below-the-fold changes.

### Step 3 — Mark conversions (the step self-collecting adds)
We collect our own conversions (Decisions §1–2), so the user marks the goal.
Easiest first:

1. **Declarative goal — no code (default onboarding):** URL match (`/thank-you`),
   click selector, or form submit. Configured on the test, zero site changes.
2. **`kumiki.track('purchase', { value })`** — precise / server-confirmed /
   revenue conversions.
3. **GTM conversion tag — reuse existing GA4 triggers:** fire `kumiki.track` from
   a GTM tag bound to the user's **existing GA4 purchase trigger**. Best combo:
   in-head snippet for exposure (zero flicker) + GTM for conversion (reuses
   tagging they already maintain). This is the "share settings/triggers with GA4"
   path.

### Why GTM is first-class, not an afterthought
Most marketing teams own GTM but not the page template. GTM install + sharing
GA4 triggers is how a real team adopts this without engineering tickets. We
support it explicitly and document the flicker trade-off rather than pretending
in-head is the only way.

---

## 4. Results — self-collected, user-based, windowed Bayesian

No GA4 Data API. Computed from kumiki's own event store (§2b), so the model is
correct by construction.

**Per variant V in a test:**
- `exposed(V)` = distinct `visitor_id` whose **first exposure** in this test was
  to V. (First-exposure assignment = the sticky bucket; later rows for the same
  visitor don't double-count.)
- `converted(V)` = distinct visitors in `exposed(V)` with a conversion event
  where `exposure_ts ≤ conversion_ts ≤ exposure_ts + W days`.
- Feed `(N = exposed, X = converted)` into **beta-binomial**: posterior
  `Beta(α₀ + X, β₀ + (N − X))`. Report **P(V is best)** via Monte-Carlo over
  posteriors, plus 95% credible intervals and (optional) expected revenue per
  visitor. Peeking-safe.

Output shape (drives dashboard + MCP `results`):
```
{ testId, window_days, variants: [{ id, exposed, converted, rate, pBest, ci95, revPerVisitor? }], winner? }
```

This is exactly the "user-based + conversion window" model — trivial here because
we own event-level data keyed by our own id.

**Outbound integrations (events flow OUT):**
- The snippet already emits a GA4 `experiment_impression` exposure via
  gtag/dataLayer. Keep it; optionally forward conversions too.
- Optional webhook per site for users who want events in their own warehouse /
  Amplitude / etc.
- So "integrate with GA4/other tools" = we *push* events to you, not we *pull*
  from your API.

---

## 5. MCP server

Wraps the control API (§3c) — every operation callable from Claude Code (the
hero positioning). Tools mirror the routes:

```
kumiki_create_site, kumiki_list_tests, kumiki_create_test, kumiki_get_test,
kumiki_edit_test, kumiki_set_variants, kumiki_apply_winner, kumiki_stop_test,
kumiki_get_results
```

- Thin: validate (shared schema) → call API with the site write key → return
  JSON. `kumiki_get_results` reads kumiki's **own** store — no GA4 OAuth/service
  account anywhere. Cleaner self-host story.
- "Full MCP coverage" is a **completeness** requirement (strategy §4) — every
  control route has a tool.

---

## 6. Cost model — how it stays free

Two frees (Decisions §4):

**Product-free:** MIT, every feature free at any scale, including winner-apply
(just a config flag). Stronger than Optimize Next (paywalls it) and unlike GA4 we
don't monetise data.

**Infra-free (user's own Cloudflare):** free-tier limits and the binding
constraint (**verified 2026-06-14** against CF docs — D1 / AE / Workers pricing):

| Operation | Free limit | Mitigation |
|---|---|---|
| Config read / pageview | ~unlimited | **CDN-cache** → bypasses Worker budget |
| Worker requests | 100k/day | only cache-misses + event writes count |
| Event writes — D1 | **100k rows written/day** (hard error at limit) | **batch** beacons; fail-open ingestion; sample exposures at high volume |
| Event writes — Analytics Engine | **100k data points/day** (samples at limit) | same; AE degrades instead of erroring |
| Dashboard (Pages) | 100k SSR/day, unlimited static | non-issue |

→ Pure free tier covers **~60–80k experiment-exposed pageviews/day**, not 100k:
the 100k/day write limit is shared by **exposures + conversions** (one row each),
so conversions eat into the exposure budget. The write path is the ceiling (reads
are cached). Stretch it with: CDN-cached config, client-batched exposures,
denominator sampling above some volume (keep all conversions).

> ⚠️ **D1 fails hard at the write ceiling** (writes are *rejected*, not queued) —
> so ingestion **must fail-open** (drop the event, never block the page), which
> matches the snippet's existing fail-open design. AE instead *samples* at its
> ceiling (graceful degradation). This is a point in AE's favour at scale, not at
> MVP (see §9.2).

**Honest asterisk:** sustained very-high traffic pushes the user onto Cloudflare
**Workers Paid ($5/mo min, 10M req/mo)** — *their* infra bill, not a kumiki gate,
and ~20× cheaper than VWO/Optimizely (¥100k+/mo). Paid write overage is cheap:
**D1 $1.00/M rows** (50M/mo included), **AE $0.25/M data points** (10M/mo
included). For the storefront/a second storefront dogfood: $0–$5, negligible. Positioning line: *"runs free on Cloudflare's free tier for most
sites; pennies on your own infra at scale; we never charge for a feature."*

---

## 7. Auth & multi-tenancy (MVP-minimal)

- One **write key per site** (hashed in `site.api_key_hash`) on control routes.
  Delivery + ingestion routes are public (config is public; ingestion is a
  public beacon, protected by rate-limit + idempotency, no PII).
- No user accounts in Phase 1 — single operator, self-hosted. Multi-user is
  post-launch. Keeps the free/self-host story clean.

---

## 8. Build sequence

1. **`packages/schema`** — extract `KumikiConfig` + zod from `types.ts` (shared
   source of truth). Small; unblocks API + MCP.
2. **`packages/api` — config + install:** D1 migrations + Hono control routes +
   CDN-cached delivery route + the **`/s.js` served-snippet endpoint** (config
   baked in). Wire the in-head one-liner end-to-end.
3. **`packages/api` — ingestion + results:** event store, batched beacon
   endpoint, user-based windowed beta-binomial results route.
4. **`packages/mcp`** — wrap the control API; verify every route has a tool.
5. **`packages/dashboard`** — CRUD UI, then the iframe visual editor.
6. **Onboarding artifacts** — Deploy-to-Cloudflare button + `npm create kumiki`
   scaffold + the GTM install guide (in-head stub + Custom HTML tag + GA4-trigger
   conversion tag).
7. **Dogfood on the storefront/a second storefront** — low-risk page, kill switch, fail-open verified;
   enable a webhook/GA4 emit to sanity-check counts. Try the GTM-shared-trigger
   conversion path against the storefront's existing GA4 setup.

Ship 1–4 to get the **agent-native loop working from Claude Code** (create test →
snippet serves it → events collected → results read back) before the dashboard.

---

## 9. Open questions

1. ~~`url_match` / page-targeting now or later?~~ → **Done (2026-06-14):**
   `urlMatch` (include/exclude × exact|prefix|contains|wildcard|regex) shipped in
   the snippet (`urlmatch.ts`) and the `Test` schema. Engine gates tests by
   `location.href`. Table-stakes for any A/B tool.
2. ~~**Event substrate: Workers Analytics Engine vs D1** for the event store.~~
   → **Resolved (2026-06-14): D1-only for the MVP; AE-hybrid only at scale.**
   Verified free ceilings are **identical — 100k writes/day either way** (D1 rows
   written; AE data points), so AE buys *zero* free-tier headroom at MVP. The
   results model (§4) *requires* D1's exact per-visitor SQL (first-exposure
   assignment + windowed conversion join); AE samples, which biases `pBest`
   exactly when samples are small (early in a test). AE's only real edges are at
   paid scale ($0.25/M vs D1 $1.00/M writes) and graceful sampling vs D1's hard
   errors at the ceiling — neither matters while dogfooding the storefront/a second storefront at low
   volume. **Decision rule:** start D1-only (ingestion fails open at the ceiling,
   per §6); **trigger to add AE-raw + D1-rollups = a real site approaching
   ~80k writes/day**, at which point sampling correction (§9.8) becomes a
   *prerequisite* of the switch, not a follow-up. Unblocks §3b/§4 (D1, D2).
3. Conversion-instrumentation API surface: JS `kumiki.track(goal, {value})` +
   declarative goals (URL match / click selector / form submit)? Which for MVP?
4. Default conversion window W (7d e-commerce default?) and whether per-test
   override is MVP.
5. Shared `packages/schema` now, or duplicate zod short-term?
6. Visual-editor selector strategy (stable selector vs nth-child path).
7. the storefront/a second storefront CSP: can we allow framing for the iframe editor? (strategy §10 Q6)
8. Sampling policy: at what volume to sample exposures, and how to correct the
   posterior for the sampling rate.
9. GTM anti-flicker stub: ship a separate ~3-line in-head stub snippet for the
   GTM install tier? (yes/no, and is it generated per-site or static.)
10. ~~Backend deploy UX: primary method for launch?~~ → **`npm create kumiki` is
    the documented primary** (2026-06-14): puts the brand in the install command.
    Deploy-to-Cloudflare button + agent-native remain as secondary paths.
    **Command shape (2026-06-14):** umbrella initializer `create-kumiki` with a
    **positional tool selector** — `npm create kumiki@latest ab` — so it scales
    to the series (`kumiki analytics`, …); bare `npm create kumiki` opens an
    interactive picker. Not per-tool names (`create-kumiki-ab`), not a flag
    (`--ab`). Mirrors Cloudflare's C3 umbrella pattern. `create-kumiki` reserved
    on npm via a stub (`packages/create-kumiki`).
