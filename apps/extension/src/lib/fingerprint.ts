export function normalizeKeyHex(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}
