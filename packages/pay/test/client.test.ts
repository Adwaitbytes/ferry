import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentRefusedError, assertAcceptableChallenge, payingFetch } from '../src/client.js';
import { USDC_TESTNET } from '@suimpp/mpp/client';
import { MAINNET_USDC_TYPE, TESTNET_USDC_TYPE, explorerTxUrl, usdcTypeFor } from '../src/constants.js';
import { GatePayments } from '../src/gateway.js';
import { DIGEST, RECIPIENT, USDC, payerKey, setup } from './fixtures.js';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

const challenge = (request: Record<string, unknown>, method = 'sui') => ({ id: 'x', realm: 'r', method, intent: 'charge', request });

describe('client guard (X-SDK-1)', () => {
  it('refuses wrong coin, price above the cap, bad recipient and non-Sui methods', () => {
    const ok = { amount: '0.01', currency: USDC, recipient: RECIPIENT };
    expect(assertAcceptableChallenge(challenge(ok), 10_000n)).toBe(10_000n);
    const reasons = [
      [challenge(ok, 'tempo'), 'NOT_SUI_CHARGE'],
      [challenge({ ...ok, currency: `0x${'de'.repeat(32)}::usdc::USDC` }), 'WRONG_COIN'],
      [challenge({ ...ok, amount: '0.010001' }), 'PRICE_ABOVE_MAX'],
      [challenge({ ...ok, amount: '0' }), 'PRICE_ABOVE_MAX'],
      [challenge({ ...ok, amount: 'lots' }), 'BAD_CHALLENGE'],
      [challenge({ ...ok, recipient: 'nobody' }), 'BAD_RECIPIENT'],
    ] as const;
    for (const [c, reason] of reasons) {
      expect(() => assertAcceptableChallenge(c, 10_000n)).toThrow(expect.objectContaining({ reason }) as PaymentRefusedError);
    }
  });
});

describe('client guard network', () => {
  it('pays only in the USDC of its own network', () => {
    const mainnet = challenge({ amount: '0.01', currency: MAINNET_USDC_TYPE, recipient: RECIPIENT });
    const testnet = challenge({ amount: '0.01', currency: TESTNET_USDC_TYPE, recipient: RECIPIENT });
    expect(assertAcceptableChallenge(testnet, 10_000n, 'testnet')).toBe(10_000n);
    expect(() => assertAcceptableChallenge(mainnet, 10_000n, 'testnet')).toThrow(expect.objectContaining({ reason: 'WRONG_COIN' }) as PaymentRefusedError);
    expect(() => assertAcceptableChallenge(testnet, 10_000n)).toThrow(expect.objectContaining({ reason: 'WRONG_COIN' }) as PaymentRefusedError);
  });

  it('maps networks to coin types and explorer links', () => {
    expect(usdcTypeFor('mainnet')).toBe(MAINNET_USDC_TYPE);
    expect(usdcTypeFor('testnet')).toBe('0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC');
    expect(TESTNET_USDC_TYPE).toBe(USDC_TESTNET.type);
    expect(explorerTxUrl('testnet', DIGEST)).toBe(`https://suiscan.xyz/testnet/tx/${DIGEST}`);
    expect(explorerTxUrl('mainnet', DIGEST)).toBe(`https://suiscan.xyz/mainnet/tx/${DIGEST}`);
  });
});

describe('payingFetch', () => {
  it('passes non-402 responses through and refuses a 402 without a challenge', async () => {
    const ok = await payingFetch('https://g.test/x', {}, { signer: payerKey, suiClient: {} as ClientWithCoreApi, maxPriceMicros: 1n, fetch: async () => new Response('{}') });
    expect(ok.paid).toBe(false);
    await expect(
      payingFetch('https://g.test/x', {}, { signer: payerKey, suiClient: {} as ClientWithCoreApi, maxPriceMicros: 1n, fetch: async () => new Response('', { status: 402 }) }),
    ).rejects.toThrow(PaymentRefusedError);
  });

  it('pays once against a real Gate challenge and re-presents the same credential while pending', async () => {
    const env = await setup();
    db = env.db;
    const payments = new GatePayments({ store: env.store, verifier: env.chain.verifier, secretKey: 'k'.repeat(40), realm: 'gate.test' });
    const issued = await payments.paymentRequired(env.card, 'https://g.test/x');
    const submitted: string[] = [];
    const authorizations: (string | null)[] = [];
    let step = 0;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      step++;
      authorizations.push(new Headers(init?.headers).get('Authorization'));
      if (step === 1) return issued.response.clone();
      if (step === 2) return new Response(JSON.stringify({ error: 'payment_pending' }), { status: 402 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const result = await payingFetch('https://g.test/x', { method: 'POST' }, {
      signer: payerKey,
      suiClient: {} as ClientWithCoreApi,
      maxPriceMicros: 10_000n,
      fetch: fakeFetch as typeof fetch,
      execute: async () => {
        submitted.push('tx');
        return { digest: DIGEST };
      },
      sleep: async () => undefined,
    });
    expect(result.paid).toBe(true);
    expect(result.response.status).toBe(200);
    expect(submitted).toHaveLength(1);
    expect(authorizations[1]).toBe(authorizations[2]);
  });
});

describe('payingFetch stops on final errors', () => {
  it('does not retry a non-retryable 402', async () => {
    const env = await setup();
    db = env.db;
    const payments = new GatePayments({ store: env.store, verifier: env.chain.verifier, secretKey: 'k'.repeat(40), realm: 'gate.test' });
    const issued = await payments.paymentRequired(env.card, 'https://g.test/x');
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      if (calls === 1) return issued.response.clone();
      return new Response(calls === 2 ? JSON.stringify({ error: 'payment_underpaid' }) : 'not json', { status: 402 });
    };
    const result = await payingFetch('https://g.test/x', {}, {
      signer: payerKey,
      suiClient: {} as ClientWithCoreApi,
      maxPriceMicros: 10_000n,
      fetch: fakeFetch as typeof fetch,
      execute: async () => ({ digest: DIGEST }),
    });
    expect(result.response.status).toBe(402);
    expect(calls).toBe(2);
  });
});
