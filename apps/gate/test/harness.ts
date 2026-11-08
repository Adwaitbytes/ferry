import type { PGlite } from '@electric-sql/pglite';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { GateGuard, GatePayments, MAINNET_USDC_TYPE, PayStore, transactionVerifier, type NormalizedTransaction, type SuiServerMethod } from '@ferry/pay';
import { freshDatabase } from '@ferry/pay/testing';
import { USDC as USDC_CURRENCY, sui as suiClientMethod } from '@suimpp/mpp/client';
import { suiCharge } from '@suimpp/mpp/server';
import { Method, Receipt } from 'mppx';
import { Mppx as MppxClient } from 'mppx/client';
import { createApp, type GateDeps } from '../src/app.js';
import { createGateLogger } from '../src/log.js';
import type { PublicFact } from '../src/recall.js';

export const WEB_ORIGIN = 'https://ferry.example';
export const ownerKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(3));
export const payerKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
export const strangerKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(5));
export const OWNER = ownerKey.toSuiAddress();
export const PAYER = payerKey.toSuiAddress();
export const CARD_ID = 'q3V7mT0xR9bK2wY5pL8nAg';
export const DIGEST = '9Xq4Ttp6bVg3Jm5r2kWc8zLhN1sQe7YdFaB3uR6vPZmK';
export const ACCOUNT_ID = `0x${'ee'.repeat(32)}`;
// Fragments, not literals, so secret scanners stay quiet on test values (X-CI-2).
const secret = (tag: string) => [tag, 'z'.repeat(40)].join('-');

export const FACT: PublicFact = { text: 'Vegetarian, allergic to cashews.', type: 'preference', sources: ['chatgpt'], heardAt: '2026-10-12', memoryRef: 'blob_AAAAAAAAAAAA' };

export interface Harness {
  app: ReturnType<typeof createApp>;
  db: PGlite;
  store: PayStore;
  statements: string[];
  logs: string[];
  recallCalls: string[];
  chain: { tx: NormalizedTransaction | null };
  recallFails: { value: boolean };
}

export async function harness(over: Partial<GateDeps> = {}): Promise<Harness> {
  const { db, sql } = await freshDatabase();
  const store = new PayStore(sql);
  await store.createCard({ id: CARD_ID, ownerAddress: OWNER, publicAccountId: ACCOUNT_ID, name: 'Food', scopeLabel: 'Food preferences', priceMicros: 10_000n, dailyCap: 1000, allowedAgents: [] });
  const chain: { tx: NormalizedTransaction | null } = { tx: null };
  const logs: string[] = [];
  const recallCalls: string[] = [];
  const recallFails = { value: false };
  const payments = new GatePayments({
    store,
    verifier: transactionVerifier(async (digest) => (chain.tx?.digest === digest ? chain.tx : null)),
    secretKey: secret('mpp'),
    realm: 'gate.test',
    // Same schema and store calls as the suimpp server method, without the fullnode.
    createMethod: (options) =>
      Method.toServer(suiCharge, {
        defaults: { currency: options.currency.type, recipient: options.recipient },
        async verify({ credential }) {
          if (await options.store.has(credential.payload.digest)) throw new Error('used');
          await options.store.set(credential.payload.digest);
          return Receipt.from({ method: 'sui', reference: credential.payload.digest, status: 'success', timestamp: new Date().toISOString() });
        },
      }) as SuiServerMethod,
  });
  const app = createApp({
    store,
    guard: new GateGuard(store),
    payments,
    recall: {
      async recall(query) {
        recallCalls.push(query);
        if (recallFails.value) throw new Error(`relayer failed for ${query}`);
        return [FACT];
      },
    },
    log: createGateLogger((line) => logs.push(line)),
    publicAccountId: ACCOUNT_ID,
    publicAccountOwner: OWNER,
    webOrigin: WEB_ORIGIN,
    sessionSecret: secret('session'),
    ...over,
  });
  sql.statements.length = 0;
  return { app, db, store, statements: sql.statements, logs, recallCalls, chain, recallFails };
}

export function paidTx(nowMs = Date.now()): NormalizedTransaction {
  return { digest: DIGEST, status: 'success', sender: PAYER, checkpoint: 1n, timestampMs: nowMs, balanceChanges: [{ owner: OWNER, coinType: MAINNET_USDC_TYPE, amount: 10_000n }] };
}

/** The real suimpp client builds the credential; `execute` stands in for the chain submit. */
export async function credentialFor(challengeResponse: Response): Promise<string> {
  const mppx = MppxClient.create({
    polyfill: false,
    methods: [suiClientMethod({ client: {} as ClientWithCoreApi, signer: payerKey, currency: USDC_CURRENCY, execute: async () => ({ digest: DIGEST }) })],
  });
  return mppx.createCredential(challengeResponse);
}
