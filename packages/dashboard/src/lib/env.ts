/**
 * Single-tenant, server-side config (F1). The dashboard points at ONE Worker
 * (the operator's own self-hosted control API) and holds its write key — both
 * read from the environment, never from the browser. This module must only be
 * imported from server code (Server Components / server actions); the key must
 * never cross to the client.
 *
 * Mirrors the MCP server's env-auth convention (`KUMIKI_API_URL`/`KUMIKI_API_KEY`,
 * fail-fast) and adds `KUMIKI_SITE_ID` because the dashboard is scoped to a
 * single site's tests (the MCP passes the site id per-call instead).
 */
export interface DashboardConfig {
  /** Origin of the control API, e.g. "https://kumiki.you.workers.dev". No trailing slash. */
  apiUrl: string;
  /** The site's write key — bearer-attached to every control request. Secret. */
  apiKey: string;
  /** The single site this dashboard manages (`site_…`). */
  siteId: string;
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Read + validate the dashboard config from the environment. Fails fast with a
 * clear message naming the missing/blank var — the same contract the MCP server
 * uses so a misconfigured deploy is obvious at the first request, not a 401 later.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): DashboardConfig {
  const apiUrl = required(env, "KUMIKI_API_URL").replace(/\/+$/, "");
  const apiKey = required(env, "KUMIKI_API_KEY");
  const siteId = required(env, "KUMIKI_SITE_ID");

  try {
    // eslint-disable-next-line no-new -- validate shape only
    new URL(apiUrl);
  } catch {
    throw new ConfigError(`KUMIKI_API_URL is not a valid URL: "${apiUrl}"`);
  }

  return { apiUrl, apiKey, siteId };
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(
      `Missing required environment variable ${key}. ` +
        `Set KUMIKI_API_URL, KUMIKI_API_KEY, and KUMIKI_SITE_ID (see packages/dashboard/README.md).`,
    );
  }
  return value.trim();
}
