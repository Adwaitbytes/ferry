import { isValidSuiAddress, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';

/**
 * Full 64-hex lowercase form (X-PAY-3). Throws on anything that is not a Sui address so a
 * malformed value can never compare equal to a real one.
 */
export function normalizeAddress(value: string): string {
  const normalized = normalizeSuiAddress(value.trim());
  if (!isValidSuiAddress(normalized)) throw new TypeError('not a Sui address');
  return normalized;
}

/** Same as `normalizeAddress` but returns null instead of throwing, for untrusted chain data. */
export function tryNormalizeAddress(value: string): string | null {
  try {
    return normalizeAddress(value);
  } catch {
    return null;
  }
}

/**
 * Normalizes the package address of a coin type and keeps module and struct names
 * case-sensitive (Move identifiers are). Compared as a whole string, never by suffix (RT-44).
 */
export function normalizeCoinType(value: string): string | null {
  try {
    return normalizeStructTag(value.trim());
  } catch {
    return null;
  }
}
