/**
 * The mirror image of the API's error envelope (`@kumikitools/api` errors.ts).
 * The API serialises every failure as `{ error: { code, message, details? } }`
 * with a STABLE machine `code`; this package's job is to carry that `code`
 * intact all the way to the calling agent (it's what an agent switches on), so
 * the client never swallows or rewrites it.
 */

/** The exact JSON shape the API returns on any non-2xx (errors.ts `ErrorBody`). */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * A typed failure from a control-API call. `code` is the API's stable code
 * (`invalid_body`, `site_not_found`, `invalid_key`, `test_not_found`,
 * `unknown_winner`, …) when the response carried an envelope, or a client-side
 * code we mint when it did not:
 *   - `network_error`     the request never reached the API (DNS/connection).
 *   - `unexpected_error`  a non-2xx with no/garbled envelope (status preserved).
 */
export class ApiClientError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never completed (network error). */
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Type guard for an `{ error: { code, message } }` envelope in unknown JSON. */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string";
}
