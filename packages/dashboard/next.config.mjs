/** @type {import('next').NextConfig} */
const nextConfig = {
  // The schema package ships TS source consumed across the workspace; let Next
  // transpile it rather than requiring a prebuilt dist (single source of truth).
  transpilePackages: ["@kumikitools/schema"],
  reactStrictMode: true,
};

export default nextConfig;
