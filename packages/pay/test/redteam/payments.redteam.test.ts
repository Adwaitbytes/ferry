import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { digestBindingMessage } from '../../src/proof.js';
import { verifyPayment, type VerifyInput } from '../../src/verify-payment.js';
import {
  ATTACKER,
  BASE_CHALLENGE,
  BASE_TX,
  CARD_ID,
  DIGEST,
  NOW_MS,
  PAYER,
  Q_SHA,
  RECIPIENT,
  USDC,
  attackerKey,
  payerKey,
  setup,
} from '../fixtures.js';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function boundSignature(key = payerKey, challengeId = BASE_CHALLENGE.id, digest = DIGEST): Promise<string> {
  return (await key.signPersonalMessage(digestBindingMessage(CARD_ID, challengeId, digest))).signature;
}

async function harness(tx = BASE_TX) {
  const env = await setup({ tx });
  db = env.db;
  let recalls = 0;
  const deps = { store: env.store, verifier: env.chain.verifier };
  const input = async (over: Partial<VerifyInput> = {}): Promise<VerifyInput> => ({
    challengeId: BASE_CHALLENGE.id,
    proof: { kind: 'digest', digest: DIGEST, signature: await boundSignature() },
    card: env.card,
    querySha256: Q_SHA,
    nowMs: NOW_MS,
    ...over,
  });
  /** Mirrors the Gate: recall runs only after verifyPayment returned ok. */
  const serve = async (over: Partial<VerifyInput> = {}) => {
    const result = await verifyPayment(await input(over), deps);
    if (result.ok) recalls++;
    return result;
  };
  const paymentRows = async () =>
    Number((await env.sql.query<{ n: string }>('SELECT count(*)::text AS n FROM payments WHERE digest = $1', [DIGEST]))[0]?.n);
  return { ...env, serve, input, deps, recalls: () => recalls, paymentRows };
}

describe('Payments (REDTEAM 9)', () => {
  it('RT-40 replayed digest is rejected and no second recall runs', async () => {
    const h = await harness();
    expect(await h.serve()).toMatchObject({ ok: true });
    const second = { ...BASE_CHALLENGE, id: 'n_second0000000000000000000000000' };
    await h.store.insertChallenge(second);
    const replay = await h.serve({ challengeId: second.id, proof: { kind: 'digest', digest: DIGEST, signature: await boundSignature(payerKey, second.id) } });
    expect(replay).toEqual({ ok: false, status: 409, code: 'PAYMENT_REPLAYED' });
    expect(h.recalls()).toBe(1);
  });

  it('RT-41 same digest raced concurrently: exactly one wins against real Postgres', async () => {
    const h = await harness();
    const input = await h.input();
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyPayment(input, h.deps)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual(Array.from({ length: 9 }, () => ({ ok: false, status: 409, code: 'PAYMENT_REPLAYED' })));
    expect(await h.paymentRows()).toBe(1);
  });

  it('RT-42 underpaid by one micro-unit, digest not consumed', async () => {
    const h = await harness({
      ...BASE_TX,
      balanceChanges: [
        { owner: PAYER, coinType: USDC, amount: -9_999n },
        { owner: RECIPIENT, coinType: USDC, amount: 9_999n },
      ],
    });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_UNDERPAID' });
    expect(await h.paymentRows()).toBe(0);
  });

  it('RT-43 paid in SUI instead of USDC', async () => {
    const h = await harness({
      ...BASE_TX,
      balanceChanges: [
        { owner: PAYER, coinType: '0x2::sui::SUI', amount: -10_000_000n },
        { owner: RECIPIENT, coinType: '0x2::sui::SUI', amount: 10_000_000n },
      ],
    });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_WRONG_COIN' });
  });

  it('RT-44 lookalike USDC from another package', async () => {
    const FAKE_USDC = `0x${'de'.repeat(32)}::usdc::USDC`;
    const h = await harness({
      ...BASE_TX,
      balanceChanges: [
        { owner: PAYER, coinType: FAKE_USDC, amount: -10_000n },
        { owner: RECIPIENT, coinType: FAKE_USDC, amount: 10_000n },
      ],
    });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_WRONG_COIN' });
  });

  it('RT-45 short-form and uppercase addresses are accepted (negative control)', async () => {
    const h = await harness({
      ...BASE_TX,
      balanceChanges: [
        { owner: PAYER, coinType: USDC.toUpperCase().replace('0X', '0x').replace('::USDC::USDC', '::usdc::USDC'), amount: -10_000n },
        { owner: RECIPIENT.toUpperCase().replace('0X', '0x'), coinType: USDC, amount: 10_000n },
      ],
    });
    expect(await h.serve()).toMatchObject({ ok: true });
  });

  it('RT-46 paid to the wrong recipient', async () => {
    const h = await harness({
      ...BASE_TX,
      balanceChanges: [
        { owner: PAYER, coinType: USDC, amount: -10_000n },
        { owner: ATTACKER, coinType: USDC, amount: 10_000n },
      ],
    });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_WRONG_RECIPIENT' });
  });

  it('RT-47 recipient balance went down, not up', async () => {
    const h = await harness({
      ...BASE_TX,
      sender: RECIPIENT,
      balanceChanges: [
        { owner: RECIPIENT, coinType: USDC, amount: -10_000n },
        { owner: PAYER, coinType: USDC, amount: 10_000n },
      ],
    });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_UNDERPAID' });
  });

  it('RT-48 payment after the challenge expired, digest not consumed', async () => {
    const h = await harness({ ...BASE_TX, timestampMs: BASE_CHALLENGE.expiresAtMs + 1 });
    expect(await h.serve({ nowMs: BASE_CHALLENGE.expiresAtMs + 5_000 })).toEqual({ ok: false, status: 402, code: 'PAYMENT_EXPIRED' });
    expect(await h.paymentRows()).toBe(0);
  });

  it('RT-48 a proof presented long after expiry is refused before any chain read', async () => {
    const h = await harness();
    expect(await h.serve({ nowMs: BASE_CHALLENGE.expiresAtMs + 10 * 60_000 })).toEqual({ ok: false, status: 402, code: 'PAYMENT_EXPIRED' });
    expect(h.chain.state.calls).toBe(0);
  });

  it('RT-49 old payment that predates the challenge', async () => {
    const h = await harness({ ...BASE_TX, timestampMs: BASE_CHALLENGE.issuedAtMs - 3_600_000 });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_EXPIRED' });
  });

  it('RT-50 bare digest presented by a third party is not bound', async () => {
    const h = await harness();
    expect(await h.serve({ proof: { kind: 'digest', digest: DIGEST } })).toEqual({ ok: false, status: 402, code: 'PAYMENT_NOT_BOUND' });
    const forged = await h.serve({ proof: { kind: 'digest', digest: DIGEST, signature: await boundSignature(attackerKey) } });
    expect(forged).toEqual({ ok: false, status: 402, code: 'PAYMENT_NOT_BOUND' });
    expect(await h.paymentRows()).toBe(0);
  });

  it('RT-50 an MPP proof signed by someone other than the sender is not bound', async () => {
    const h = await harness();
    const challenge = { id: BASE_CHALLENGE.id, method: 'sui', intent: 'charge', request: { amount: '0.01', currency: USDC, recipient: RECIPIENT } };
    const { mppProofMessage } = await import('../../src/proof.js');
    const signature = (await attackerKey.signPersonalMessage(mppProofMessage(challenge, DIGEST))).signature;
    expect(await h.serve({ proof: { kind: 'mpp', digest: DIGEST, signature, challenge } })).toEqual({
      ok: false,
      status: 402,
      code: 'PAYMENT_NOT_BOUND',
    });
    const other = { ...challenge, id: 'some_other_challenge_id_000000' };
    expect(await h.serve({ proof: { kind: 'mpp', digest: DIGEST, signature, challenge: other } })).toMatchObject({ code: 'PAYMENT_NOT_BOUND' });
  });

  it('RT-51 failed or unfinalized transaction; pending succeeds once checkpointed', async () => {
    const failed = await harness({ ...BASE_TX, status: 'failure' });
    expect(await failed.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_FAILED' });
    await failed.db.close();

    const h = await harness({ ...BASE_TX, checkpoint: null });
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_PENDING' });
    expect(await h.paymentRows()).toBe(0);
    h.chain.state.tx = BASE_TX;
    expect(await h.serve()).toMatchObject({ ok: true });
  });

  it('RT-51 unknown digest is reported as not found', async () => {
    const h = await harness(null as never);
    h.chain.state.tx = null;
    expect(await h.serve()).toEqual({ ok: false, status: 402, code: 'PAYMENT_NOT_FOUND' });
  });

  it('RT-52 challenge for a cheap card used on an expensive card', async () => {
    const h = await harness();
    const expensive = await h.store.createCard({ ...h.card, id: 'Zr8kP1vN4cT7wQ2mX5yB0a', priceMicros: 1_000_000n, allowedAgents: [] });
    expect(await h.serve({ card: expensive })).toEqual({ ok: false, status: 402, code: 'CHALLENGE_MISMATCH' });
  });

  it('RT-52 allowed agents are compared with the transaction sender', async () => {
    const h = await harness();
    const restricted = await h.store.updateCard(CARD_ID, RECIPIENT, { allowedAgents: [ATTACKER] });
    expect(await h.serve({ card: restricted })).toEqual({ ok: false, status: 403, code: 'AGENT_NOT_ALLOWED' });
    const allowed = await h.store.updateCard(CARD_ID, RECIPIENT, { allowedAgents: [PAYER.toUpperCase().replace('0X', '0x')] });
    expect(await h.serve({ card: allowed })).toMatchObject({ ok: true });
  });

  it('RT-54 a killed card never verifies a payment', async () => {
    const h = await harness();
    await h.store.killCard(CARD_ID, RECIPIENT);
    expect(await h.serve({ card: await h.store.getCard(CARD_ID) })).toEqual({ ok: false, status: 404, code: 'NOT_FOUND' });
    expect(await h.serve({ card: null })).toEqual({ ok: false, status: 404, code: 'NOT_FOUND' });
  });
});
