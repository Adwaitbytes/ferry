import type { PGlite } from '@electric-sql/pglite';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { USDC as USDC_CURRENCY, sui as suiClientMethod } from '@suimpp/mpp/client';
import { suiCharge, type SuiServerOptions } from '@suimpp/mpp/server';
import { X402_PAYMENT_RESPONSE_HEADER, buildX402SignedPayment, type X402Requirements } from '@suimpp/mpp/x402';
import { Method, Receipt } from 'mppx';
import { Mppx as MppxClient } from 'mppx/client';
import { afterEach, describe, expect, it } from 'vitest';
import { GatePayments, type PaymentRequiredBody, type SuiServerMethod } from '../src/gateway.js';
import type { NormalizedTransaction } from '../src/verifier.js';
import { DIGEST, PAYER, Q_SHA, RECIPIENT, USDC, attackerKey, payerKey, setup } from './fixtures.js';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

// Built from fragments so secret scanners do not flag a test value (X-CI-2).
const SECRET = ['hmac', 'x'.repeat(40)].join('-');
const RESOURCE = 'https://gate.test/v1/cards/q3V7mT0xR9bK2wY5pL8nAg/recall';

/**
 * Stands in for the suimpp server method without a fullnode: same schema, same store calls
 * (has before, set last), so the Gate's binding of the store to the request is exercised.
 */
function offlineMethod(options: SuiServerOptions, chainOk: () => boolean): SuiServerMethod {
  return Method.toServer(suiCharge, {
    defaults: { currency: options.currency.type, recipient: options.recipient },
    async verify({ credential }) {
      const digest = credential.payload.digest;
      if (await options.store.has(digest)) throw new Error('digest used');
      if (!chainOk()) throw new Error('fullnode says no');
      await options.store.set(digest);
      return Receipt.from({ method: 'sui', reference: digest, status: 'success', timestamp: new Date().toISOString() });
    },
  }) as SuiServerMethod;
}

function fakeSuiClient(executed: { digest: string; amount: string; success?: boolean }): ClientWithCoreApi {
  return {
    core: {
      getChainIdentifier: async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' }),
      getCurrentSystemState: async () => ({ systemState: { epoch: '1305' } }),
      executeTransaction: async () => ({
        $kind: 'Transaction',
        Transaction: {
          digest: executed.digest,
          status: { success: executed.success ?? true, error: null },
          balanceChanges: [{ coinType: USDC, address: RECIPIENT, amount: executed.amount }],
        },
      }),
    },
  } as unknown as ClientWithCoreApi;
}

async function gate(options: { chainOk?: () => boolean; tx?: (now: number) => NormalizedTransaction; x402?: ClientWithCoreApi } = {}) {
  const env = await setup();
  db = env.db;
  const now = Date.now();
  env.chain.state.tx = options.tx?.(now) ?? { digest: DIGEST, status: 'success', sender: PAYER, checkpoint: 1n, timestampMs: now, balanceChanges: [{ owner: RECIPIENT, coinType: USDC, amount: 10_000n }] };
  const payments = new GatePayments({
    store: env.store,
    verifier: env.chain.verifier,
    secretKey: SECRET,
    realm: 'gate.test',
    createMethod: (o) => offlineMethod(o, options.chainOk ?? (() => true)),
    ...(options.x402 ? { x402Client: options.x402 } : {}),
  });
  return { ...env, payments };
}

/** Real suimpp client method; `execute` replaces the chain submit so no funds move. */
async function mppCredential(challengeResponse: Response, key = payerKey): Promise<string> {
  const mppx = MppxClient.create({
    polyfill: false,
    methods: [suiClientMethod({ client: {} as ClientWithCoreApi, signer: key, currency: USDC_CURRENCY, execute: async () => ({ digest: DIGEST }) })],
  });
  return mppx.createCredential(challengeResponse);
}

describe('GatePayments MPP', () => {
  it('issues a 402 with an MPP challenge, x402 terms and a stored binding', async () => {
    const g = await gate({ x402: fakeSuiClient({ digest: DIGEST, amount: '10000' }) });
    const issued = await g.payments.paymentRequired(g.card, RESOURCE);
    expect(issued.response.status).toBe(402);
    expect(issued.response.headers.get('WWW-Authenticate')).toMatch(/^Payment id="/);
    const body = (await issued.response.json()) as PaymentRequiredBody;
    expect(body.mpp).toMatchObject({ challengeId: issued.challengeId, amountMicros: '10000', currency: USDC, recipient: RECIPIENT });
    expect(body.accepts[0]).toMatchObject({ scheme: 'exact', network: 'sui:mainnet', maxAmountRequired: '10000', payTo: RECIPIENT });
    expect(await g.store.getChallenge(issued.challengeId)).toMatchObject({ cardId: g.card.id, priceMicros: 10_000n });
  });

  it('works with the real suimpp server method on the challenge path', async () => {
    const env = await setup();
    db = env.db;
    const payments = new GatePayments({ store: env.store, verifier: env.chain.verifier, secretKey: SECRET, realm: 'gate.test' });
    const issued = await payments.paymentRequired(env.card, RESOURCE);
    expect(issued.response.headers.get('WWW-Authenticate')).toContain('method="sui"');
    expect((await issued.response.json()) as PaymentRequiredBody).toMatchObject({ accepts: [] });
  });

  it('settles a real suimpp credential once, re-verified through the verifier, with a receipt header', async () => {
    const g = await gate();
    const issued = await g.payments.paymentRequired(g.card, RESOURCE);
    const credential = await mppCredential(issued.response);
    const request = () => new Request(RESOURCE, { method: 'POST', headers: { Authorization: credential } });
    const result = await g.payments.settle(request(), g.card, Q_SHA);
    expect(result).toMatchObject({ ok: true, digest: DIGEST, payer: PAYER, amountMicros: 10_000n, dialect: 'mpp' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.receiptId).toMatch(/^rcpt_/);
    expect(result.attach(new Response('{}')).headers.get('Payment-Receipt')).toBeTruthy();
    expect(g.chain.state.calls).toBe(1);
    expect(await g.payments.settle(request(), g.card, Q_SHA)).toMatchObject({ ok: false, status: 409, code: 'PAYMENT_REPLAYED' });
  });

  it('rejects a credential whose proof was signed by someone other than the sender', async () => {
    const g = await gate();
    const issued = await g.payments.paymentRequired(g.card, RESOURCE);
    const credential = await mppCredential(issued.response, attackerKey);
    const result = await g.payments.settle(new Request(RESOURCE, { headers: { Authorization: credential } }), g.card, Q_SHA);
    expect(result).toMatchObject({ ok: false, code: 'PAYMENT_NOT_BOUND' });
  });

  it('rejects challenges not issued by this server and malformed credentials', async () => {
    const g = await gate();
    const other = new GatePayments({ store: g.store, verifier: g.chain.verifier, secretKey: `${SECRET}-other`, realm: 'gate.test' });
    const foreign = await mppCredential((await other.paymentRequired(g.card, RESOURCE)).response);
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { Authorization: foreign } }), g.card, Q_SHA)).toMatchObject({
      code: 'CHALLENGE_MISMATCH',
    });
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { Authorization: 'Payment !!!' } }), g.card, Q_SHA)).toMatchObject({
      code: 'PAYMENT_INVALID',
    });
    expect(await g.payments.settle(new Request(RESOURCE), g.card, Q_SHA)).toMatchObject({ code: 'PAYMENT_INVALID' });
  });

  it('reports the library refusing as unverified and keeps the digest unused', async () => {
    const g = await gate({ chainOk: () => false });
    const credential = await mppCredential((await g.payments.paymentRequired(g.card, RESOURCE)).response);
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { Authorization: credential } }), g.card, Q_SHA)).toMatchObject({
      status: 402,
      code: 'PAYMENT_UNVERIFIED',
    });
    expect(await g.store.isDigestUsed(DIGEST)).toBe(false);
  });

  it('passes through verifier failures before the library runs', async () => {
    const g = await gate({ tx: (now) => ({ digest: DIGEST, status: 'success', sender: PAYER, checkpoint: null, timestampMs: now, balanceChanges: [] }) });
    const credential = await mppCredential((await g.payments.paymentRequired(g.card, RESOURCE)).response);
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { Authorization: credential } }), g.card, Q_SHA)).toMatchObject({
      code: 'PAYMENT_PENDING',
    });
  });

  it('detects the dialect from headers', () => {
    expect(GatePayments.dialectOf(new Request(RESOURCE, { headers: { 'X-PAYMENT': 'x' } }))).toBe('x402');
    expect(GatePayments.dialectOf(new Request(RESOURCE, { headers: { Authorization: 'Bearer abc' } }))).toBeNull();
    expect(GatePayments.dialectOf(new Request(RESOURCE))).toBeNull();
  });
});

describe('GatePayments x402 fallback', () => {
  async function signedHeader(g: Awaited<ReturnType<typeof gate>>) {
    const issued = await g.payments.paymentRequired(g.card, RESOURCE);
    const body = (await issued.response.json()) as PaymentRequiredBody;
    const requirements = body.accepts[0] as X402Requirements;
    return (await buildX402SignedPayment({ requirements, signer: payerKey })).header;
  }

  it('executes the signed bytes, re-verifies, commits once and returns X-PAYMENT-RESPONSE', async () => {
    const g = await gate({ x402: fakeSuiClient({ digest: DIGEST, amount: '10000' }) });
    const header = await signedHeader(g);
    const request = () => new Request(RESOURCE, { headers: { 'X-PAYMENT': header } });
    const result = await g.payments.settle(request(), g.card, Q_SHA);
    expect(result).toMatchObject({ ok: true, dialect: 'x402', digest: DIGEST, payer: PAYER });
    if (!result.ok) throw new Error('unreachable');
    expect(result.attach(new Response('{}')).headers.get(X402_PAYMENT_RESPONSE_HEADER)).toBeTruthy();
    expect(await g.payments.settle(request(), g.card, Q_SHA)).toMatchObject({ ok: false, code: 'PAYMENT_REPLAYED' });
  });

  it('refuses when the Tatum re-verification disagrees with the executing node', async () => {
    const g = await gate({
      x402: fakeSuiClient({ digest: DIGEST, amount: '10000' }),
      tx: (now) => ({ digest: DIGEST, status: 'success', sender: PAYER, checkpoint: 1n, timestampMs: now, balanceChanges: [{ owner: RECIPIENT, coinType: USDC, amount: 1n }] }),
    });
    const result = await g.payments.settle(new Request(RESOURCE, { headers: { 'X-PAYMENT': await signedHeader(g) } }), g.card, Q_SHA);
    expect(result).toMatchObject({ ok: false, code: 'PAYMENT_UNDERPAID' });
    expect(await g.store.isDigestUsed(DIGEST)).toBe(false);
  });

  it('refuses failed settlement, garbage headers, unknown challenges and missing client', async () => {
    const g = await gate({ x402: fakeSuiClient({ digest: DIGEST, amount: '10000', success: false }) });
    const header = await signedHeader(g);
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { 'X-PAYMENT': header } }), g.card, Q_SHA)).toMatchObject({ code: 'PAYMENT_UNVERIFIED' });
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { 'X-PAYMENT': 'bm90IGpzb24' } }), g.card, Q_SHA)).toMatchObject({ code: 'PAYMENT_INVALID' });
    const expensive = { ...g.card, priceMicros: 1_000_000n };
    expect(await g.payments.settle(new Request(RESOURCE, { headers: { 'X-PAYMENT': header } }), expensive, Q_SHA)).toMatchObject({ code: 'CHALLENGE_MISMATCH' });
    const noClient = new GatePayments({ store: g.store, verifier: g.chain.verifier, secretKey: SECRET, realm: 'gate.test' });
    expect(await noClient.settle(new Request(RESOURCE, { headers: { 'X-PAYMENT': header } }), g.card, Q_SHA)).toMatchObject({ code: 'PAYMENT_INVALID' });
  });

  it('refuses an x402 payment presented after the challenge expired', async () => {
    const g = await gate({ x402: fakeSuiClient({ digest: DIGEST, amount: '10000' }) });
    const header = await signedHeader(g);
    const later = new GatePayments({
      store: g.store,
      verifier: g.chain.verifier,
      secretKey: SECRET,
      realm: 'gate.test',
      x402Client: fakeSuiClient({ digest: DIGEST, amount: '10000' }),
      now: () => Date.now() + 60 * 60_000,
    });
    expect(await later.settle(new Request(RESOURCE, { headers: { 'X-PAYMENT': header } }), g.card, Q_SHA)).toMatchObject({ code: 'PAYMENT_EXPIRED' });
  });

  it('omits x402 terms when chain info cannot be read', async () => {
    const env = await setup();
    db = env.db;
    const broken = { core: { getChainIdentifier: async () => Promise.reject(new Error('down')), getCurrentSystemState: async () => ({}) } } as unknown as ClientWithCoreApi;
    const payments = new GatePayments({ store: env.store, verifier: env.chain.verifier, secretKey: SECRET, realm: 'gate.test', x402Client: broken });
    expect(((await (await payments.paymentRequired(env.card, RESOURCE)).response.json()) as PaymentRequiredBody).accepts).toEqual([]);
  });
});
