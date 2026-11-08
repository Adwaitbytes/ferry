import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MAINNET_USDC_TYPE } from '../src/constants.js';
import { PayStore, type Card, type StoredChallenge } from '../src/store.js';
import { transactionVerifier, type NormalizedTransaction } from '../src/verifier.js';
import { freshDatabase } from '../src/testing.js';

// Shared constants from REDTEAM 1. PAYER and ATTACKER are real keys here because binding
// cases need real signatures; their addresses play the roles of "0xbb.." and "0xcc..".
export const USDC = MAINNET_USDC_TYPE;
export const RECIPIENT = `0x${'aa'.repeat(32)}`;
export const payerKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
export const attackerKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9));
export const PAYER = payerKey.toSuiAddress();
export const ATTACKER = attackerKey.toSuiAddress();
export const DIGEST = '9Xq4Ttp6bVg3Jm5r2kWc8zLhN1sQe7YdFaB3uR6vPZmK';
export const CARD_ID = 'q3V7mT0xR9bK2wY5pL8nAg';
export const PRICE_MICROS = 10_000n;
export const ACCOUNT_ID = `0x${'ee'.repeat(32)}`;
export const Q_SHA = 'a'.repeat(64);

export const BASE_CHALLENGE: StoredChallenge = {
  id: 'n_7c1f0e9a4b2d4c3e8f5a6b7c8d9e0f1a',
  cardId: CARD_ID,
  priceMicros: PRICE_MICROS,
  recipient: RECIPIENT,
  issuedAtMs: 1794311940000,
  expiresAtMs: 1794312540000,
};

export const BASE_TX: NormalizedTransaction = {
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

export const NOW_MS = 1794312005000;

export const BASE_CARD = {
  id: CARD_ID,
  ownerAddress: RECIPIENT,
  publicAccountId: ACCOUNT_ID,
  name: 'Food',
  scopeLabel: 'Food preferences',
  priceMicros: PRICE_MICROS,
  dailyCap: 1000,
  allowedAgents: [] as string[],
};

/** A fake Tatum client: returns whatever transaction the test sets, and counts calls. */
export function fakeChain(initial: NormalizedTransaction | null = BASE_TX) {
  const state = { tx: initial, calls: 0 };
  const verifier = transactionVerifier(async (digest) => {
    state.calls++;
    return state.tx && state.tx.digest === digest ? state.tx : null;
  });
  return { state, verifier };
}

export async function setup(options: { tx?: NormalizedTransaction | null } = {}) {
  const { db, sql } = await freshDatabase();
  const store = new PayStore(sql);
  const card: Card = await store.createCard(BASE_CARD);
  await store.insertChallenge(BASE_CHALLENGE);
  const chain = fakeChain(options.tx === undefined ? BASE_TX : options.tx);
  return { db, sql, store, card, chain };
}
