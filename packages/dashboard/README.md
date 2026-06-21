# @kumikitools/dashboard — Kumiki A/B control dashboard (F1)

A Next.js 15 (App Router) CRUD UI over the Kumiki A/B **control API**. It is the
third surface onto the same control routes — alongside the MCP server and raw
REST. **The control surface IS the MCP surface IS this dashboard.**

## What it does (F1)

Full CRUD over one site's tests:

- **List** every test, with status, coverage, variant count, and applied winner.
- **Create** a test (name, status, coverage, conversion window, URL targeting,
  variants with `changes[]`).
- **Edit** a test's control fields (B3 `PATCH`).
- **Replace variants** (B4 `PUT`).
- **Apply a winner** to 100% (B5) and the **kill switch** (B6).
- **Results** — the user-based, windowed beta-binomial summary (D2 / ARCH §4):
  exposed/converted, rate, P(best), 95% CI, and the posterior winner.

> **F2 visual editor (shipped):** the **"Pick visually"** launcher under each
> variant authors `changes[]` no-code by clicking the live page. It is a
> **bookmarklet overlay**, not an iframe — many sites (incl. production storefronts) send
> `X-Frame-Options`, so the picker is injected into the real page and posts the
> changes back over `postMessage` (ARCH §9.6/§9.7, `@kumikitools/editor`). You can
> still type `changes[]` as JSON in the textarea.

## Design

- **Single-tenant, server-side auth.** The dashboard points at **one** Worker and
  holds its write key — both from the environment (`src/lib/env.ts`, fail-fast,
  mirroring the MCP server). The key is attached server-side
  (`src/lib/api.ts`) and **never reaches the browser**: forms POST to server
  actions (`src/app/actions.ts`), which call the API. To manage another site,
  run another instance (the self-host model — you already deploy your own Worker).
- **Contracts come from `@kumikitools/schema`.** `Test`, `Variant`, `Results`,
  and URL targeting are imported, never re-declared. The dashboard only describes
  the control-plane envelope (`TestResource`) and request bodies on top.
- **`api.ts` is the dashboard's `api-client.ts`** — the same convention as the
  MCP server: one HTTP helper, bearer auth, non-2xx → `ApiClientError` with the
  API's stable `code` preserved and surfaced to the operator (ARCH §3c).

## Run locally

```bash
cp packages/dashboard/.env.example packages/dashboard/.env.local   # fill in
npm install
npm run dev -w @kumikitools/dashboard        # http://localhost:3000
```

Required env (see `.env.example`): `KUMIKI_API_URL`, `KUMIKI_API_KEY`,
`KUMIKI_SITE_ID`.

## Test / typecheck / build

```bash
npm run test -w @kumikitools/dashboard        # api-client + env unit tests
npm run typecheck -w @kumikitools/dashboard
npm run build -w @kumikitools/dashboard
```

## Deploy (Cloudflare, via OpenNext)

The app uses Server Components + server actions, so it deploys as a **Cloudflare
Worker with static assets** through the [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)
adapter (ARCH §6 — runs on the user's own free tier, same self-host model as the
API Worker). Config: [`open-next.config.ts`](./open-next.config.ts) +
[`wrangler.jsonc`](./wrangler.jsonc).

```bash
# one-time: set the write key as a secret (never put it in wrangler.jsonc)
npx wrangler secret put KUMIKI_API_KEY

# edit wrangler.jsonc `vars` for KUMIKI_API_URL + KUMIKI_SITE_ID, then:
npm run preview -w @kumikitools/dashboard    # build + run the Worker locally
npm run deploy  -w @kumikitools/dashboard    # build + deploy to your account
```

`KUMIKI_API_URL` and `KUMIKI_SITE_ID` are non-secret `vars` in `wrangler.jsonc`;
`KUMIKI_API_KEY` is a **secret** (`wrangler secret put` or the dashboard Secrets
UI) — it stays server-side (`src/lib/env.ts` reads all three from `process.env`,
which OpenNext populates from the Worker env). `npm run start` after `npm run
build` still serves it from any Node host if you prefer not to use Cloudflare.
