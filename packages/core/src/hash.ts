const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * SHA-256, truncated to `bytes` (default 12, i.e. 96 bits) and base64url encoded.
 * Used for conversation ids and quotes in headers: stable for dedupe, not readable.
 */
export async function hashShort(input: string, bytes = 12): Promise<string> {
  if (bytes < 6 || bytes > 32) throw new RangeError('hashShort: bytes must be 6..32');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
  return toBase64Url(digest.subarray(0, bytes));
}

/** 128-bit random id, base64url. Used for Share Card ids (PRD 6.2: unguessable). */
export function randomId128(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}
