/** @type {import('next').NextConfig} */
const nextConfig = {
  // The schema package ships TS source consumed across the workspace; let Next
  // transpile it rather than requiring a prebuilt dist (single source of truth).
  transpilePackages: ["@kumikitools/schema", "@kumikitools/editor"],
  reactStrictMode: true,
};

export default nextConfig;

// OpenNext → Cloudflare (ARCH §6): make `getCloudflareContext()` and the
// wrangler.jsonc `vars` available during `next dev`, so local dev mirrors the
// deployed Worker. No-op for the production build/deploy path.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
