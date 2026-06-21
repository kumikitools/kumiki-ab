# Kumiki A/B

**Agent-native A/B testing. Free, self-hosted, MCP-first.**

Run experiments from Claude Code. Apply winning variants to 100% of traffic — no paywall, no SaaS bill.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kumikitools/kumiki-ab/tree/main/packages/api)

## Quickstart

```bash
# 1. Deploy your backend
npm create kumiki@latest ab
# Follow printed steps: wrangler d1 create → paste id → migrations apply → wrangler deploy

# 2. Add the snippet to your site's <head>
# <script src="https://<your-worker>.workers.dev/s.js?site=SITE_ID"></script>

# 3. Mark conversions
# window.KUMIKI.track('purchase', { value: 4980 })
```

→ [Full install guide](docs/install.md) — CLI, Deploy-to-Cloudflare button, agent-native, GTM (3-tier), and marking conversions (Step 3).

---

## Why

Every A/B tool charges you for the one thing that actually matters: **applying the winner**.

VWO, Optimizely, and Optimize Next all gate "winning variant → 100% rollout" behind paid plans (¥100k+/mo). Kumiki A/B makes it free, self-hosted, and fully operable by an AI agent via MCP.

## Hero features

- **Win-pattern application — free.** Roll the winning variant to 100% of traffic with a single MCP call.
- **MCP-first.** Every operation — create test, update traffic split, read results, apply winner — is callable from Claude Code. No dashboard required.
- **Self-hosted on Cloudflare.** Your data stays in your own D1 database and Workers. Zero vendor lock-in.

## Stack

| Layer | Tech |
|---|---|
| Snippet | Lightweight JS (`<head>`) — anti-flicker, sticky bucketing, fail-open, GA4 exposure events |
| API | Cloudflare Workers + Hono + D1 |
| MCP server | Full REST coverage for Claude Code |
| Dashboard | Next.js 15 + visual editor (iframe) |
| Stats | Bayesian (beta-binomial) — peeking-resistant |
| Analytics | GA4 Data API — no proprietary tracking |

## Status

Early development. Dogfooded on real e-commerce traffic.

## License

MIT
