# kumiki-ab

Agent-native A/B testing on Cloudflare Workers + D1.

## Deploy in 3 steps

1. **Create a D1 database and deploy the Worker**

   ```sh
   wrangler d1 create kumiki
   # Paste the returned database_id into wrangler.toml
   wrangler d1 migrations apply kumiki --remote
   wrangler deploy
   ```

2. **Create a site and get your write key** (via the [Kumiki MCP](https://github.com/kumikitools/kumiki-ab) or the API directly)

3. **Install the snippet** — add one line to your site's `<head>`:

   ```html
   <script src="https://<your-worker>.workers.dev/s.js?site=<SITE_ID>"></script>
   ```

See [docs/install.md](../../docs/install.md) for full install options (GTM, agent-native via Claude Code).
