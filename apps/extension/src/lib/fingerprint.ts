/**
 * Short key fingerprint shown in the side panel and the web app before the pairing signature
 * (THREAT_MODEL X-PAIR-1). It is derived from the public key alone, so the web app can recompute
 * it from the exact bytes it puts into `add_delegate_key` and the user compares the two.
 * Format: first 8 and last 8 hex characters of the 32-byte key, in groups of 4.
 */
export function keyFingerprint(publicKeyHex: string): string {
  const hex = publicKeyHex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex))
    throw new RangeError('keyFingerprint: expected a 32-byte hex public key');
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(56, 60), hex.slice(60, 64)].join(' ');
}

export function normalizeKeyHex(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}
