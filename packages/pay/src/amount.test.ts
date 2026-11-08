import { describe, expect, it } from 'vitest';
import { decimalToMicros, microsToDecimal, parseMicros } from './amount.js';
import { normalizeAddress, normalizeCoinType, tryNormalizeAddress } from './normalize.js';

describe('amount', () => {
  it('converts decimals to micros without floating point', () => {
    expect(decimalToMicros('0.01')).toBe(10_000n);
    expect(decimalToMicros('1')).toBe(1_000_000n);
    expect(decimalToMicros('12.000001')).toBe(12_000_001n);
  });
  it('rejects ambiguous or lossy amounts', () => {
    for (const bad of ['0.0000001', '-1', '1e3', '.5', '01', '', 'NaN']) {
      expect(() => decimalToMicros(bad)).toThrow(RangeError);
    }
  });
  it('formats micros as decimals', () => {
    expect(microsToDecimal(10_000n)).toBe('0.01');
    expect(microsToDecimal(1_000_000n)).toBe('1');
    expect(microsToDecimal(0n)).toBe('0');
    expect(() => microsToDecimal(-1n)).toThrow(RangeError);
  });
  it('parses micro strings strictly', () => {
    expect(parseMicros('10000')).toBe(10_000n);
    expect(() => parseMicros('10.5')).toThrow(RangeError);
    expect(() => parseMicros('-1')).toThrow(RangeError);
  });
});

describe('normalize', () => {
  it('pads and lowercases addresses', () => {
    expect(normalizeAddress('0xAB')).toBe(`0x${'0'.repeat(62)}ab`);
    expect(tryNormalizeAddress('not an address')).toBeNull();
  });
  it('normalizes the package of a coin type only', () => {
    expect(normalizeCoinType('0x2::sui::SUI')).toBe(`0x${'0'.repeat(63)}2::sui::SUI`);
    expect(normalizeCoinType('garbage')).toBeNull();
  });
});
