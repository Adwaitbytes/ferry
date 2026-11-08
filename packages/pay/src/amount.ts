import { USDC_DECIMALS } from './constants.js';

const WHOLE_RE = /^(0|[1-9][0-9]{0,11})$/;
const FRACTION_RE = /^[0-9]{1,6}$/;
const MICROS_RE = /^(0|[1-9][0-9]{0,17})$/;
const SCALE = 10n ** BigInt(USDC_DECIMALS);

/**
 * "0.01" to 10000n. Rejects more than 6 fractional digits instead of truncating, because
 * silently rounding a price is how an underpayment becomes "valid".
 */
export function decimalToMicros(amount: string): bigint {
  const parts = amount.split('.');
  const [whole = '', frac] = parts;
  if (parts.length > 2 || !WHOLE_RE.test(whole) || (frac !== undefined && !FRACTION_RE.test(frac))) {
    throw new RangeError('amount must be a USDC decimal with at most 6 places');
  }
  return BigInt(whole) * SCALE + BigInt((frac ?? '').padEnd(USDC_DECIMALS, '0'));
}

/** 10000n to "0.01". The inverse of `decimalToMicros`, with trailing zeros trimmed. */
export function microsToDecimal(micros: bigint): string {
  if (micros < 0n) throw new RangeError('micros must be non-negative');
  const whole = micros / SCALE;
  const frac = (micros % SCALE).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

/** Parses a non-negative integer string of micro-USDC (the wire format for amounts). */
export function parseMicros(value: string): bigint {
  if (!MICROS_RE.test(value)) throw new RangeError('micros must be a non-negative integer string');
  return BigInt(value);
}
