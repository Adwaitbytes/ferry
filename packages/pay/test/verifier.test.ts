import { describe, expect, it } from 'vitest';
import { evaluateTransaction, withFinalityRetry, type PaymentVerification, type PaymentVerifier } from '../src/verifier.js';
import { fromVerifierFailure } from '../src/errors.js';
import { BASE_TX, DIGEST, RECIPIENT, USDC } from './fixtures.js';

const REQUEST = { digest: DIGEST, recipient: RECIPIENT, coinType: USDC, minAmountMicros: 10_000n, notBeforeMs: 0, notAfterMs: Number.MAX_SAFE_INTEGER };

describe('verifier', () => {
  it('reports an unparseable sender as failed and no movement as underpaid', () => {
    expect(evaluateTransaction({ ...BASE_TX, sender: 'nope' }, REQUEST)).toEqual({ ok: false, reason: 'FAILED' });
    expect(evaluateTransaction({ ...BASE_TX, balanceChanges: [] }, REQUEST)).toEqual({ ok: false, reason: 'UNDERPAID' });
    expect(evaluateTransaction({ ...BASE_TX, balanceChanges: [{ owner: 'junk', coinType: 'junk', amount: 5n }] }, REQUEST)).toEqual({ ok: false, reason: 'UNDERPAID' });
  });

  it('retries only NOT_FINAL and NOT_FOUND, with a bounded number of attempts', async () => {
    const answers: PaymentVerification[] = [
      { ok: false, reason: 'NOT_FOUND' },
      { ok: false, reason: 'NOT_FINAL' },
      { ok: true, sender: RECIPIENT, amountMicros: 1n, checkpoint: 1n, timestampMs: 1 },
    ];
    let calls = 0;
    const inner: PaymentVerifier = { verify: async () => answers[calls++] ?? { ok: false, reason: 'FAILED' } };
    const sleeps: number[] = [];
    const retrying = withFinalityRetry(inner, { attempts: 4, delayMs: 10, sleep: async (ms) => void sleeps.push(ms) });
    expect(await retrying.verify(REQUEST)).toMatchObject({ ok: true });
    expect(sleeps).toEqual([10, 20]);

    const final: PaymentVerifier = { verify: async () => ({ ok: false, reason: 'UNDERPAID' }) };
    expect(await withFinalityRetry(final, { attempts: 3, delayMs: 1 }).verify(REQUEST)).toEqual({ ok: false, reason: 'UNDERPAID' });
    const pending: PaymentVerifier = { verify: async () => ({ ok: false, reason: 'NOT_FINAL' }) };
    expect(await withFinalityRetry(pending, { attempts: 2, delayMs: 1 }).verify(REQUEST)).toEqual({ ok: false, reason: 'NOT_FINAL' });
    expect(fromVerifierFailure('NOT_FINAL')).toEqual({ ok: false, status: 402, code: 'PAYMENT_PENDING' });
  });
});
