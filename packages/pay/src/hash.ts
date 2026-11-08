const encoder = new TextEncoder();

/** Lowercase hex SHA-256 via WebCrypto, so this file is safe in Node, Vercel and browsers. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 128 random bits, base64url (22 chars). */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function newReceiptId(): string {
  return `rcpt_${randomToken()}`;
}
