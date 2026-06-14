import type { KumikiMcpConfig } from "./config.js";
import { ApiClientError, isApiErrorEnvelope } from "./errors.js";

/**
 * The one HTTP helper every tool calls — the shared convention C1–C8 inherit.
 * A tool never touches `fetch` directly; it calls `client.post/get/patch/put`
 * with a control-route path and (optionally) a body, and gets back either the
 * parsed JSON resource or an `ApiClientError` carrying the API's stable `code`.
 *
 * Responsibilities, kept in this one place so the tools stay thin:
 *   - attach `Authorization: Bearer <write key>` and the JSON content-type
 *   - serialise the body, parse the response
 *   - translate any non-2xx into an `ApiClientError` (envelope `code` preserved,
 *     ARCH §3c), and any transport failure into a `network_error`
 */
export class ApiClient {
  constructor(
    private readonly config: KumikiMcpConfig,
    /** Injectable for tests; defaults to the global fetch. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  patch(path: string, body: unknown): Promise<unknown> {
    return this.request("PATCH", path, body);
  }

  put(path: string, body: unknown): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  /**
   * Issue one request and return its parsed JSON. Throws `ApiClientError` on any
   * non-2xx (or transport failure) — callers map that to a tool error so the
   * `code` reaches the agent.
   */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.config.apiUrl}${path}`;

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ApiClientError(
        0,
        "network_error",
        `Could not reach the Kumiki API at ${url}: ${reason}`,
      );
    }

    const text = await res.text();
    const parsed = parseJson(text);

    if (!res.ok) {
      if (isApiErrorEnvelope(parsed)) {
        throw new ApiClientError(
          res.status,
          parsed.error.code,
          parsed.error.message,
          parsed.error.details,
        );
      }
      // Non-2xx without a recognisable envelope — surface the status, don't
      // pretend to know a code.
      throw new ApiClientError(
        res.status,
        "unexpected_error",
        `Kumiki API returned HTTP ${res.status}`,
        text || undefined,
      );
    }

    return parsed;
  }
}

/** Parse a response body, tolerating an empty or non-JSON body (→ undefined). */
function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
