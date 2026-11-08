import { describe, expect, it } from 'vitest';
import { TransactionError } from '@mysten/sui/client';
import { evaluatePayment, normalizeTransaction, verifyUsdcPayment, type NormalizedTransaction, type PaymentRequirement } from './payment.js';
import { ChainDataError, TatumSui, type PaymentTransaction } from './rpc.js';
import { USDC_COIN_TYPE } from './constants.js';
import { fakeClock, fakeRpc, loadFixture } from './fixtures.testutil.js';

/* Shared constants from docs/REDTEAM.md section 1. */
const USDC = USDC_COIN_TYPE;
const RECIPIENT = `0x${'aa'.repeat(32)}`;
const PAYER = `0x${'bb'.repeat(32)}`;
const ATTACKER = `0x${'cc'.repeat(32)}`;
const DIGEST = '9Xq4Ttp6bVg3Jm5r2kWc8zLhN1sQe7YdFaB3uR6vPZmK';
const PRICE_MICROS = 10_000n;
const ISSUED_AT = 1794311940000;
const EXPIRES_AT = 1794312540000;

const BASE_TX: NormalizedTransaction = {
  digest: DIGEST,
  status: 'success',
  sender: PAYER,
  checkpoint: 182004771n,
  timestampMs: 1794312000000,
  balanceChanges: [
    { owner: PAYER, coinType: USDC, amount: -10_000n },
    { owner: RECIPIENT, coinType: USDC, amount: 10_000n },
  ],
};

const REQ: PaymentRequirement = {
  recipient: RECIPIENT,
  minAmountMicros: PRICE_MICROS,
  coinType: USDC,
  notBeforeMs: ISSUED_AT - 30_000,
  notAfterMs: EXPIRES_AT,
};

const changes = (...list: [string, string, bigint][]) => list.map(([owner, coinType, amount]) => ({ owner, coinType, amount }));

describe('evaluatePayment (REDTEAM payment cases)', () => {
  it('accepts an exact payment and returns the sender as payer', () => {
    expect(evaluatePayment(BASE_TX, REQ)).toEqual({
      ok: true,
      digest: DIGEST,
      payer: PAYER,
      recipient: RECIPIENT,
      coinType: USDC,
      amountMicros: 10_000n,
      checkpoint: 182004771n,
      timestampMs: 1794312000000,
    });
  });

  it('defaults the coin type to Mainnet USDC', () => {
    const withoutCoin: PaymentRequirement = { recipient: RECIPIENT, minAmountMicros: PRICE_MICROS, notBeforeMs: REQ.notBeforeMs, notAfterMs: EXPIRES_AT };
    expect(evaluatePayment(BASE_TX, withoutCoin).ok).toBe(true);
  });

  it('RT-42 underpaid by one micro-unit', () => {
    const tx = { ...BASE_TX, balanceChanges: changes([PAYER, USDC, -9_999n], [RECIPIENT, USDC, 9_999n]) };
    expect(evaluatePayment(tx, REQ)).toEqual({ ok: false, digest: DIGEST, reason: 'UNDERPAID' });
  });

  it('RT-43 paid in SUI instead of USDC', () => {
    const tx = { ...BASE_TX, balanceChanges: changes([PAYER, '0x2::sui::SUI', -10_000_000n], [RECIPIENT, '0x2::sui::SUI', 10_000_000n]) };
    expect(evaluatePayment(tx, REQ)).toMatchObject({ ok: false, reason: 'WRONG_COIN' });
  });

  it('RT-44 lookalike USDC from another package', () => {
    const fake = `0x${'de'.repeat(32)}::usdc::USDC`;
    const tx = { ...BASE_TX, balanceChanges: changes([PAYER, fake, -10_000n], [RECIPIENT, fake, 10_000n]) };
    expect(evaluatePayment(tx, REQ)).toMatchObject({ ok: false, reason: 'WRONG_COIN' });
  });

  it('RT-45 short-form and uppercase addresses still match (via normalizeTransaction)', () => {
    const upperCoin = USDC.toUpperCase().replace('0X', '0x').replace('::USDC::USDC', '::usdc::USDC');
    const raw: PaymentTransaction = {
      digest: DIGEST,
      signatures: [],
      epoch: null,
      timestampMs: BASE_TX.timestampMs,
      checkpoint: '182004771',
      status: { success: true, error: null },
      balanceChanges: [
        { address: PAYER, coinType: upperCoin, amount: '-10000' },
        { address: RECIPIENT.toUpperCase().replace('0X', '0x'), coinType: USDC, amount: '10000' },
      ],
      transaction: { sender: PAYER },
    } as unknown as PaymentTransaction;
    expect(evaluatePayment(normalizeTransaction(raw), { ...REQ, recipient: RECIPIENT.toUpperCase().replace('0X', '0x') }).ok).toBe(true);
  });

  it('RT-46 paid to the wrong recipient', () => {
    const tx = { ...BASE_TX, balanceChanges: changes([PAYER, USDC, -10_000n], [ATTACKER, USDC, 10_000n]) };
    expect(evaluatePayment(tx, REQ)).toMatchObject({ ok: false, reason: 'WRONG_RECIPIENT' });
  });

  it('RT-47 recipient balance went down, not up', () => {
    const tx = { ...BASE_TX, sender: RECIPIENT, balanceChanges: changes([RECIPIENT, USDC, -10_000n], [PAYER, USDC, 10_000n]) };
    expect(evaluatePayment(tx, REQ)).toMatchObject({ ok: false, reason: 'UNDERPAID' });
  });

  it('RT-48 payment after the challenge expired', () => {
    expect(evaluatePayment({ ...BASE_TX, timestampMs: EXPIRES_AT + 1 }, REQ)).toMatchObject({ reason: 'EXPIRED' });
  });

  it('RT-49 old payment that predates the challenge', () => {
    expect(evaluatePayment({ ...BASE_TX, timestampMs: ISSUED_AT - 3_600_000 }, REQ)).toMatchObject({ reason: 'EXPIRED' });
  });

  it('window bounds are inclusive', () => {
    expect(evaluatePayment({ ...BASE_TX, timestampMs: REQ.notBeforeMs }, REQ).ok).toBe(true);
    expect(evaluatePayment({ ...BASE_TX, timestampMs: REQ.notAfterMs }, REQ).ok).toBe(true);
    expect(evaluatePayment({ ...BASE_TX, timestampMs: REQ.notBeforeMs - 1 }, REQ)).toMatchObject({ reason: 'EXPIRED' });
  });

  it('RT-51 failed and unfinalized transactions', () => {
    expect(evaluatePayment({ ...BASE_TX, status: 'failure' }, REQ)).toMatchObject({ reason: 'FAILED' });
    expect(evaluatePayment({ ...BASE_TX, checkpoint: null }, REQ)).toMatchObject({ reason: 'NOT_FINAL' });
    expect(evaluatePayment({ ...BASE_TX, timestampMs: null }, REQ)).toMatchObject({ reason: 'NOT_FINAL' });
  });

  it('failure beats every other check', () => {
    const tx = { ...BASE_TX, status: 'failure' as const, checkpoint: null, timestampMs: 0, balanceChanges: [] };
    expect(evaluatePayment(tx, REQ)).toMatchObject({ reason: 'FAILED' });
  });

  it('a transaction that pays nobody is WRONG_RECIPIENT', () => {
    expect(evaluatePayment({ ...BASE_TX, balanceChanges: [] }, REQ)).toMatchObject({ reason: 'WRONG_RECIPIENT' });
  });

  it('overpayment is accepted and reports the real amount', () => {
    const tx = { ...BASE_TX, balanceChanges: changes([RECIPIENT, USDC, 10_001n]) };
    expect(evaluatePayment(tx, REQ)).toMatchObject({ ok: true, amountMicros: 10_001n });
  });

  it('bigint edge cases: values past 2^53 and the u64 ceiling stay exact', () => {
    const huge = (1n << 64n) - 1n;
    const tx = { ...BASE_TX, balanceChanges: changes([RECIPIENT, USDC, huge]) };
    expect(evaluatePayment(tx, { ...REQ, minAmountMicros: huge })).toMatchObject({ ok: true, amountMicros: huge });
    const justUnder = { ...BASE_TX, balanceChanges: changes([RECIPIENT, USDC, huge - 1n]) };
    expect(evaluatePayment(justUnder, { ...REQ, minAmountMicros: huge })).toMatchObject({ reason: 'UNDERPAID' });
    const precise = 9_007_199_254_740_993n;
    const p = { ...BASE_TX, balanceChanges: changes([RECIPIENT, USDC, precise - 1n]) };
    expect(evaluatePayment(p, { ...REQ, minAmountMicros: precise })).toMatchObject({ reason: 'UNDERPAID' });
  });

  it('rejects invalid requirements instead of guessing', () => {
    expect(() => evaluatePayment(BASE_TX, { ...REQ, minAmountMicros: 0n })).toThrow(RangeError);
    expect(() => evaluatePayment(BASE_TX, { ...REQ, minAmountMicros: -1n })).toThrow(RangeError);
    expect(() => evaluatePayment(BASE_TX, { ...REQ, minAmountMicros: 1n << 64n })).toThrow(RangeError);
    expect(() => evaluatePayment(BASE_TX, { ...REQ, minAmountMicros: 10_000 as unknown as bigint })).toThrow(RangeError);
    expect(() => evaluatePayment(BASE_TX, { ...REQ, notBeforeMs: 2, notAfterMs: 1 })).toThrow(RangeError);
    expect(() => evaluatePayment(BASE_TX, { ...REQ, notAfterMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('normalizeTransaction', () => {
  const real = loadFixture<{ $kind: string; balanceChanges: unknown } & PaymentTransaction>('usdc-transfer-tx.json');

  it('normalizes a real Mainnet USDC transaction', () => {
    const tx = normalizeTransaction(real);
    expect(tx.status).toBe('success');
    expect(tx.checkpoint).toBe(343098821n);
    expect(tx.sender).toBe('0x7eebeaaf0140c5515c1098a8336c804c19da9d94aeaacbdef4049d54e673e4c3');
    expect(tx.balanceChanges).toContainEqual({ owner: tx.sender, coinType: USDC, amount: 90_770_860n });
    expect(tx.balanceChanges[0]?.coinType).toBe(`0x${'0'.repeat(63)}2::sui::SUI`);
  });

  it('rejects malformed amounts and missing senders', () => {
    const bad = { ...real, balanceChanges: [{ address: PAYER, coinType: USDC, amount: '1.5' }] };
    expect(() => normalizeTransaction(bad)).toThrow(ChainDataError);
    const noSender = { ...real, transaction: { ...real.transaction, sender: null } } as unknown as PaymentTransaction;
    expect(() => normalizeTransaction(noSender)).toThrow(/no sender/);
  });

  it('maps a failed status', () => {
    const failed = { ...real, status: { success: false, error: { message: 'x' } } } as unknown as PaymentTransaction;
    expect(normalizeTransaction(failed).status).toBe('failure');
  });
});

describe('verifyUsdcPayment through the Tatum client', () => {
  const real = loadFixture<PaymentTransaction>('usdc-transfer-tx.json');
  const realDigest = real.digest;
  const payee = '0x7eebeaaf0140c5515c1098a8336c804c19da9d94aeaacbdef4049d54e673e4c3';
  const at = real.timestampMs ?? 0;
  const window = { notBeforeMs: at - 1000, notAfterMs: at + 1000 };

  function setup(result: () => Promise<unknown>) {
    const { rpc, mocks } = fakeRpc();
    mocks.getTransaction.mockImplementation(result as never);
    return { sui: new TatumSui({ rpc, clock: fakeClock(), ratePerSec: 1000 }), mocks };
  }

  it('verifies a real transaction read with balance changes and sender', async () => {
    const { sui, mocks } = setup(async () => ({ $kind: 'Transaction', Transaction: real }));
    const result = await verifyUsdcPayment(sui, { digest: realDigest, recipient: payee, minAmountMicros: 90_770_860n, coinType: USDC, ...window });
    expect(result).toMatchObject({ ok: true, payer: payee, amountMicros: 90_770_860n });
    expect(mocks.getTransaction).toHaveBeenCalledWith({ digest: realDigest, include: { balanceChanges: true, transaction: true } });
  });

  it('reads FailedTransaction results as FAILED', async () => {
    const failed = { ...real, status: { success: false, error: { message: 'abort' } } };
    const { sui } = setup(async () => ({ $kind: 'FailedTransaction', FailedTransaction: failed }));
    const result = await verifyUsdcPayment(sui, { digest: realDigest, recipient: payee, minAmountMicros: 1n, ...window });
    expect(result).toMatchObject({ ok: false, reason: 'FAILED' });
  });

  it('NOT_FOUND for an unknown digest, without masking other errors', async () => {
    const { sui } = setup(async () => {
      throw new TransactionError('notFound', realDigest);
    });
    expect(await verifyUsdcPayment(sui, { digest: realDigest, recipient: payee, minAmountMicros: 1n, ...window })).toEqual({
      ok: false,
      digest: realDigest,
      reason: 'NOT_FOUND',
    });
    const { sui: broken } = setup(async () => {
      throw new Error('boom');
    });
    await expect(verifyUsdcPayment(broken, { digest: realDigest, recipient: payee, minAmountMicros: 1n, ...window })).rejects.toThrow('boom');
  });

  it('NOT_FOUND for a malformed digest without an upstream call', async () => {
    const { sui, mocks } = setup(async () => ({}));
    const result = await verifyUsdcPayment(sui, { digest: 'not-a-digest', recipient: payee, minAmountMicros: 1n, ...window });
    expect(result).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(mocks.getTransaction).not.toHaveBeenCalled();
  });

  it('NOT_FINAL results are re-read; final results are cached', async () => {
    const pending = { ...real, checkpoint: null, timestampMs: null };
    const { sui, mocks } = setup(async () => ({ $kind: 'Transaction', Transaction: pending }));
    const input = { digest: realDigest, recipient: payee, minAmountMicros: 1n, ...window };
    expect(await verifyUsdcPayment(sui, input)).toMatchObject({ reason: 'NOT_FINAL' });
    mocks.getTransaction.mockImplementation((async () => ({ $kind: 'Transaction', Transaction: real })) as never);
    expect((await verifyUsdcPayment(sui, input)).ok).toBe(true);
    expect((await verifyUsdcPayment(sui, input)).ok).toBe(true);
    expect(mocks.getTransaction).toHaveBeenCalledTimes(2);
    expect(sui.getMeter().methods['GetTransaction']?.cacheHits).toBe(1);
  });

  it('validates the requirement before any upstream call', async () => {
    const { sui, mocks } = setup(async () => ({}));
    await expect(verifyUsdcPayment(sui, { digest: realDigest, recipient: payee, minAmountMicros: 0n, ...window })).rejects.toThrow(RangeError);
    expect(mocks.getTransaction).not.toHaveBeenCalled();
  });
});
