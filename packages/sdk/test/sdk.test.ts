import type { PGlite } from '@electric-sql/pglite';
import { MAINNET_USDC_TYPE, PayStore, GatePayments, transactionVerifier, sha256Hex, type SuiServerMethod } from '@ferry/pay';
import { freshDatabase } from '@ferry/pay/testing';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { suiCharge } from '@suimpp/mpp/server';
import { Method, Receipt } from 'mppx';
import { afterEach, describe, expect, it } from 'vitest';
import { FerryError, createFerry, ferry } from '../src/index.js';

const CARD_ID = 'q3V7mT0xR9bK2wY5pL8nAg';
const DIGEST = '9Xq4Ttp6bVg3Jm5r2kWc8zLhN1sQe7YdFaB3uR6vPZmK';
const OWNER = `0x${'aa'.repeat(32)}`;
const payer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
const BASE = 'https://gate.test';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

/** A miniature Gate built from @ferry/pay so the SDK runs the real 402 round trip. */
async function gate(price = 10_000n) {
  const env = await freshDatabase();
  db = env.db;
  const store = new PayStore(env.sql);
  const card = await store.createCard({ id: CARD_ID, ownerAddress: OWNER, publicAccountId: `0x${'ee'.repeat(32)}`, name: 'Food', scopeLabel: 'Food', priceMicros: price, dailyCap: 10, allowedAgents: [] });
  const payments = new GatePayments({
    store,
    verifier: transactionVerifier(async () => ({ digest: DIGEST, status: 'success', sender: payer.toSuiAddress(), checkpoint: 1n, timestampMs: Date.now(), balanceChanges: [{ owner: OWNER, coinType: MAINNET_USDC_TYPE, amount: price }] })),
    secretKey: ['hmac', 'q'.repeat(40)].join('-'),
    realm: 'gate.test',
    createMethod: (o) =>
      Method.toServer(suiCharge, {
        defaults: { currency: o.currency.type, recipient: o.recipient },
        async verify({ credential }) {
          await o.store.set(credential.payload.digest);
          return Receipt.from({ method: 'sui', reference: credential.payload.digest, status: 'success', timestamp: new Date().toISOString() });
        },
      }) as SuiServerMethod,
  });
  const submitted: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === `/v1/cards/${CARD_ID}`) return Response.json({ id: CARD_ID, name: 'Food', scopeLabel: 'Food', priceMicros: '10000', price: '0.01', currency: MAINNET_USDC_TYPE, recipient: OWNER });
    if (url.pathname === '/v1/cards/AAAAAAAAAAAAAAAAAAAAAA') return new Response('{"error":"not_found"}', { status: 404 });
    const { q } = (await request.clone().json()) as { q: string };
    if (GatePayments.dialectOf(request) === null) return (await payments.paymentRequired(card, request.url)).response;
    const settled = await payments.settle(request, card, await sha256Hex(q));
    if (!settled.ok) return Response.json({ error: settled.code.toLowerCase() }, { status: settled.status });
    return settled.attach(
      Response.json({
        cardId: CARD_ID,
        results: [{ text: 'Vegetarian.', type: 'preference', sources: ['chatgpt'], heardAt: '2026-10-12', memoryRef: 'blob_AAAAAAAAAAAA' }],
        payment: { digest: settled.digest, amountMicros: settled.amountMicros.toString(), receiptId: settled.receiptId, payer: settled.payer },
      }),
    );
  };
  const client = createFerry({
    baseUrl: BASE,
    fetch: fetch as typeof globalThis.fetch,
    execute: async () => {
      submitted.push('tx');
      return { digest: DIGEST };
    },
  });
  return { client, submitted };
}

describe('@ferry/sdk', () => {
  it('pays the 402 once and returns a validated GateRecallResult', async () => {
    const { client, submitted } = await gate();
    const result = await client.card(CARD_ID).recall('food preferences', { payer });
    expect(result.results[0]?.text).toBe('Vegetarian.');
    expect(result.payment).toMatchObject({ digest: DIGEST, amountMicros: '10000', payer: payer.toSuiAddress() });
    expect(submitted).toHaveLength(1);
  });

  it('refuses a challenge above maxPriceMicros before any payment (X-SDK-1)', async () => {
    const { client, submitted } = await gate(20_000n);
    await expect(client.card(CARD_ID).recall('food', { payer })).rejects.toMatchObject({ code: 'PRICE_ABOVE_MAX' });
    expect(submitted).toHaveLength(0);
  });

  it('reads public card info and surfaces Gate errors with codes', async () => {
    const { client } = await gate();
    expect(await client.card(CARD_ID).info()).toMatchObject({ price: '0.01', recipient: OWNER });
    await expect(client.card('AAAAAAAAAAAAAAAAAAAAAA').info()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('validates inputs and refuses insecure gates', () => {
    expect(() => createFerry({ baseUrl: 'http://gate.example' })).toThrow(FerryError);
    expect(() => createFerry({ baseUrl: 'not a url' })).toThrow(FerryError);
    expect(() => createFerry({ baseUrl: 'http://localhost:3000' })).not.toThrow();
    expect(() => createFerry({ baseUrl: BASE }).card('../admin')).toThrow(/card id/);
    expect(() => ferry.card(CARD_ID)).not.toThrow();
  });

  it('rejects empty queries and malformed or mismatched responses', async () => {
    const c = createFerry({ baseUrl: `${BASE}/`, fetch: async () => Response.json({ cardId: CARD_ID, results: [] }) });
    await expect(c.card(CARD_ID).recall('', { payer })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(c.card(CARD_ID).recall('food', { payer })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const payment = { digest: DIGEST, amountMicros: '1', receiptId: 'r', payer: `0x${'cc'.repeat(32)}` };
    const other = createFerry({ baseUrl: BASE, fetch: async () => Response.json({ cardId: 'Zr8kP1vN4cT7wQ2mX5yB0a', results: [], payment }) });
    await expect(other.card(CARD_ID).recall('food', { payer })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const wrongPayer = createFerry({ baseUrl: BASE, fetch: async () => Response.json({ cardId: CARD_ID, results: [], payment }) });
    await expect(wrongPayer.card(CARD_ID).recall('food', { payer })).rejects.toThrow(/different payer/);
    const textError = createFerry({ baseUrl: BASE, fetch: async () => new Response('boom', { status: 503 }) });
    await expect(textError.card(CARD_ID).recall('food', { payer })).rejects.toMatchObject({ code: 'HTTP_503' });
    const thrown = createFerry({ baseUrl: BASE, fetch: async () => Promise.reject(new TypeError('offline')) });
    await expect(thrown.card(CARD_ID).recall('food', { payer })).rejects.toThrow(TypeError);
  });
});
