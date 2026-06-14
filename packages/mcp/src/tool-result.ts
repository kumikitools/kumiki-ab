import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiClientError } from "./errors.js";

/**
 * The success/error mapping every tool returns through — the shared convention
 * C1–C8 inherit alongside the api-client.
 *
 * MCP distinguishes *protocol* errors (thrown → JSON-RPC error) from *tool*
 * errors (returned with `isError: true` → visible to the calling agent). An API
 * failure is a tool error: we return it as content so the agent can read the
 * `code` and decide what to do, rather than throwing and hiding it behind a
 * generic protocol fault.
 */

/** Wrap a successful API resource as a tool result (pretty JSON text). */
export function toToolResult(resource: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(resource, null, 2) }],
  };
}

/**
 * Map a thrown value to a tool error. An `ApiClientError` keeps the API's stable
 * `code` (the thing an agent switches on); anything else becomes a generic
 * `unexpected_error` so we never leak a raw stack to the caller.
 */
export function toToolError(err: unknown): CallToolResult {
  const envelope = errorEnvelope(err);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
  };
}

/** The `{ error: { code, message, details? } }` envelope mirrored from the API. */
function errorEnvelope(err: unknown): {
  error: { code: string; message: string; details?: unknown };
} {
  if (err instanceof ApiClientError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    };
  }
  return {
    error: {
      code: "unexpected_error",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}
