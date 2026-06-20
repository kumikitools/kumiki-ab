import type { Context } from "hono";

/**
 * The error envelope — the ONE shape every failed response uses. Reference
 * pattern: routes never hand-roll error JSON; they `throw new ApiError(...)` and
 * the app-level `onError` (index.ts) serialises it through here.
 *
 *   { "error": { "code": "...", "message": "...", "details"?: ... } }
 *
 * `code` is a stable machine string (clients/MCP switch on it); `message` is
 * human-facing; `details` is optional structured context (e.g. zod issues).
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/** HTTP status codes that carry a body. Mirrors Hono's own type, kept local. */
type ContentfulStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 500;

/** Serialise any thrown value into the envelope. Used by app.onError. */
export function toErrorResponse(err: unknown, c: Context): Response {
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status);
  }
  // Unknown/unexpected — never leak internals to the client.
  const body: ErrorBody = {
    error: { code: "internal_error", message: "Internal server error" },
  };
  return c.json(body, 500);
}
