// OpenNext → Cloudflare adapter config (ARCH §6). Turns the Next.js 15 app
// (Server Components + server actions) into a Cloudflare Worker with static
// assets, deployable on the user's own Cloudflare account (the same self-host
// model as the API Worker). Defaults are deliberate: no R2 incremental cache
// for the MVP — the dashboard is single-tenant and low-traffic, and every page
// fetches the API with `cache: "no-store"` (src/lib/api.ts), so there is no Next
// data cache to persist. Add `incrementalCache` here only if a future page opts
// into ISR/`revalidate`.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
