import { isValidSuiAddress, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';

/** 0x-prefixed, 64 lowercase hex chars. Accepts short forms and any hex case (X-PAY-3). */
export function normalizeAddress(address: string): string {
  const normalized = normalizeSuiAddress(address.trim().toLowerCase());
  if (!isValidSuiAddress(normalized)) throw new TypeError('invalid Sui address');
  return normalized;
}

export function isSuiAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

/**
 * Full normalized struct tag so `0x2::sui::SUI` and the 64-hex form compare equal, and a
 * lookalike `::usdc::USDC` from another package never does (RT-44). Only the address part is
 * case-folded; module and type names are case-sensitive in Move.
 */
export function normalizeCoinType(coinType: string): string {
  const trimmed = coinType.trim();
  const sep = trimmed.indexOf('::');
  if (sep <= 0) throw new TypeError('invalid coin type');
  const folded = `${trimmed.slice(0, sep).toLowerCase()}${trimmed.slice(sep)}`;
  return normalizeStructTag(folded);
}

export function sameCoinType(a: string, b: string): boolean {
  try {
    return normalizeCoinType(a) === normalizeCoinType(b);
  } catch {
    return false;
  }
}
