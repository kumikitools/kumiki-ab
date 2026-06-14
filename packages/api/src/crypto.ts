/**
 * Write-key primitives (ARCHITECTURE.md §7). One write key per site; only its
 * SHA-256 hash is ever stored (`site.api_key_hash`). The plaintext key is shown
 * to the operator exactly once, at site creation.
 */

const KEY_PREFIX = "ksk_"; // kumiki secret key

/** Mint a new write key: `ksk_` + 24 random bytes hex. Returned to the operator once. */
export function generateWriteKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return KEY_PREFIX + toHex(bytes);
}

/** SHA-256 → lowercase hex. Used to hash keys for storage and comparison. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time comparison of two hex strings of equal length. Avoids leaking
 * how many leading characters of a guessed key hash were correct.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
