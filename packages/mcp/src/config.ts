/**
 * Env auth (ARCHITECTURE.md §5, §7). The MCP server is configured entirely from
 * the environment — there are no per-call credentials. A single operator points
 * it at their deployed Worker and hands it the site's write key:
 *
 *   KUMIKI_API_URL   the Worker origin (e.g. https://kumiki-api.example.workers.dev)
 *   KUMIKI_API_KEY   the site write key (`ksk_…`), sent as `Authorization: Bearer`
 *
 * Both are required; the server refuses to start without them (fail fast, with a
 * message that names the missing var) rather than emitting opaque 401s per call.
 */
export interface KumikiMcpConfig {
  /** Worker origin, trailing slash stripped so paths concatenate cleanly. */
  apiUrl: string;
  /** Site write key (`ksk_…`) sent as a bearer token on every control call. */
  apiKey: string;
}

/** A bare `process.env`-shaped map: the only input `loadConfig` reads. */
export type Env = Record<string, string | undefined>;

/**
 * Build the config from the environment, or throw a clear `Error` naming the
 * first missing/blank variable. Called once at startup (index.ts); the thrown
 * message is what the operator sees when the server fails to launch.
 */
export function loadConfig(env: Env): KumikiMcpConfig {
  const apiUrl = env.KUMIKI_API_URL?.trim();
  if (!apiUrl) {
    throw new Error(
      "KUMIKI_API_URL is required — set it to your Kumiki Worker origin, " +
        "e.g. https://kumiki-api.<account>.workers.dev",
    );
  }

  const apiKey = env.KUMIKI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "KUMIKI_API_KEY is required — set it to your site write key (ksk_…), " +
        "minted by `POST /v1/sites`.",
    );
  }

  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}
