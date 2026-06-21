/**
 * The one HTTP helper every Server Component / server action calls — the
 * dashboard's analogue of the MCP server's `api-client.ts`. A page never touches
 * `fetch`; it calls a typed method (`listTests`, `createTest`, …) and gets back
 * either the parsed resource or an `ApiClientError` carrying the API's stable
 * `code` (ARCH §3c).
 *
 * Server-only: it reads the write key from the environment and attaches it as a
 * bearer token. Importing this from a Client Component is a bug — the key would
 * be bundled to the browser. All callers are server code.
 */
import { loadConfig, type DashboardConfig } from "./env";
import type {
  ApiErrorEnvelope,
  CreateTestBody,
  PatchTestBody,
  Results,
  TestResource,
  Variant,
} from "./types";

/** A non-2xx (or transport) failure, preserving the API's stable error `code`. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function isApiErrorEnvelope(v: unknown): v is ApiErrorEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as { error: unknown }).error === "object" &&
    (v as { error: { code?: unknown } }).error !== null &&
    typeof (v as { error: { code?: unknown } }).error.code === "string"
  );
}

export class KumikiApiClient {
  constructor(
    private readonly config: DashboardConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // ── Control routes (ARCH §3c), one method each ───────────────────────────

  /** B1 `GET /v1/sites/:id/tests` — every test of the configured site. */
  listTests(): Promise<TestResource[]> {
    return this.request("GET", `/v1/sites/${this.config.siteId}/tests`) as Promise<
      TestResource[]
    >;
  }

  /** A2 `POST /v1/sites/:id/tests` — create a test under the configured site. */
  createTest(body: CreateTestBody): Promise<TestResource> {
    return this.request(
      "POST",
      `/v1/sites/${this.config.siteId}/tests`,
      body,
    ) as Promise<TestResource>;
  }

  /** B2 `GET /v1/tests/:id` — full test + variants. */
  getTest(testId: string): Promise<TestResource> {
    return this.request("GET", `/v1/tests/${testId}`) as Promise<TestResource>;
  }

  /** B3 `PATCH /v1/tests/:id` — partial edit (status/coverage/window/name/targeting). */
  patchTest(testId: string, body: PatchTestBody): Promise<TestResource> {
    return this.request("PATCH", `/v1/tests/${testId}`, body) as Promise<TestResource>;
  }

  /** B4 `PUT /v1/tests/:id/variants` — atomically replace the variant set. */
  replaceVariants(testId: string, variants: Variant[]): Promise<TestResource> {
    return this.request("PUT", `/v1/tests/${testId}/variants`, {
      variants,
    }) as Promise<TestResource>;
  }

  /** B5 `POST /v1/tests/:id/apply` — roll a winner to 100% (status → applied). */
  applyWinner(testId: string, winner: string): Promise<TestResource> {
    return this.request("POST", `/v1/tests/${testId}/apply`, {
      winner,
    }) as Promise<TestResource>;
  }

  /** B6 `POST /v1/tests/:id/stop` — the instant kill switch (status → stopped). */
  stopTest(testId: string): Promise<TestResource> {
    return this.request("POST", `/v1/tests/${testId}/stop`) as Promise<TestResource>;
  }

  /** D2 `GET /v1/tests/:id/results` — user-based windowed beta-binomial summary. */
  getResults(testId: string): Promise<Results> {
    return this.request("GET", `/v1/tests/${testId}/results`) as Promise<Results>;
  }

  /**
   * Issue one request and return its parsed JSON. Throws `ApiClientError` on any
   * non-2xx (envelope `code` preserved) or transport failure (`network_error`),
   * mirroring the MCP client so error handling is identical across surfaces.
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.config.apiUrl}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
    };
    const init: RequestInit = { method, headers, cache: "no-store" };
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

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Build a client from the environment. The standard entry point for pages/actions. */
export function getClient(): KumikiApiClient {
  return new KumikiApiClient(loadConfig());
}
