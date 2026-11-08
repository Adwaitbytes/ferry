import { describe, expect, it } from 'vitest';
import { isSuiAddress, normalizeAddress, normalizeCoinType, sameCoinType } from './address.js';
import { USDC_COIN_TYPE } from './constants.js';

describe('address normalization (X-PAY-3)', () => {
  it('normalizes short and mixed-case addresses to 64 lowercase hex', () => {
    expect(normalizeAddress('0x2')).toBe(`0x${'0'.repeat(63)}2`);
    expect(normalizeAddress(` 0x${'AB'.repeat(32)} `)).toBe(`0x${'ab'.repeat(32)}`);
    expect(() => normalizeAddress('0xzz')).toThrow(TypeError);
    expect(() => normalizeAddress(`0x${'1'.repeat(65)}`)).toThrow(TypeError);
  });

  it('recognizes address-shaped strings', () => {
    expect(isSuiAddress('0x6')).toBe(true);
    expect(isSuiAddress(`0x${'aB'.repeat(32)}`)).toBe(true);
    expect(isSuiAddress('6')).toBe(false);
    expect(isSuiAddress(`0x${'a'.repeat(65)}`)).toBe(false);
  });

  it('compares coin types by full normalized tag, never by suffix', () => {
    expect(normalizeCoinType('0x2::sui::SUI')).toBe(`0x${'0'.repeat(63)}2::sui::SUI`);
    expect(sameCoinType(USDC_COIN_TYPE.replace('0xdba3', '0xDBA3'), USDC_COIN_TYPE)).toBe(true);
    expect(sameCoinType(`0x${'de'.repeat(32)}::usdc::USDC`, USDC_COIN_TYPE)).toBe(false);
    expect(sameCoinType(USDC_COIN_TYPE.replace('::USDC', '::usdc'), USDC_COIN_TYPE)).toBe(false);
    expect(sameCoinType('garbage', USDC_COIN_TYPE)).toBe(false);
    expect(() => normalizeCoinType('::usdc::USDC')).toThrow(TypeError);
  });
});
