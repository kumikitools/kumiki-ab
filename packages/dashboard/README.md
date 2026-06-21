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

> **Not in F1:** the iframe **visual editor** (F2) — the no-code way to author
> `changes[]` by clicking the live page. It's blocked on two open decisions
> (selector strategy §9.6, CSP/framing §9.7). Until then, `changes[]` is authored
> as JSON in the variant editor. See `TASKS.md`.

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

## Deploy (Cloudflare Pages)

Intended target is Cloudflare Pages (ARCH §6 — 100k SSR/day on the free tier).
Because the app uses Server Components + server actions, deploy via the
`@opennextjs/cloudflare` adapter (a follow-up wires the adapter + `wrangler.jsonc`).
Set the three `KUMIKI_*` vars as Pages environment variables / secrets. Until the
adapter is wired, `npm run start` after `npm run build` serves it from any Node host.
