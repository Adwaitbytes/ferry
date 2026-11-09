/**
 * Browser-safe entry (`@ferry/chain/tx`): MemWal account transaction builders and Mainnet
 * constants. No Node modules, no network, no Tatum key. The web app signs these with the user's
 * wallet (wallet-paid gas is the default path).
 *
 * Sponsored gas (RESEARCH 1.6, DECISIONS 2026-11-08): the relayer's `POST /sponsor` accepts
 * exactly one of these calls. Build the kind bytes with
 * `await tx.build({ client, onlyTransactionKind: true })`, sign the authorization with
 * `createSponsorAuthorization` from `@mysten-incubation/memwal`, and fall back to the wallet-paid
 * transaction if the relayer refuses. That flow lives with the memwal and web owners.
 */
import { Transaction } from '@mysten/sui/transactions';
import { MEMWAL_MAX_LABEL_BYTES, MEMWAL_PACKAGE_ID, MEMWAL_REGISTRY_ID, SUI_CLOCK_ID } from '../constants.js';
import { normalizeAddress } from '../address.js';

export * from '../constants.js';
export { normalizeAddress, normalizeCoinType, sameCoinType, isSuiAddress } from '../address.js';

export const MEMWAL_TARGETS = {
  createAccount: `${MEMWAL_PACKAGE_ID}::account::create_account`,
  addDelegateKey: `${MEMWAL_PACKAGE_ID}::account::add_delegate_key`,
  removeDelegateKey: `${MEMWAL_PACKAGE_ID}::account::remove_delegate_key`,
} as const;

const ED25519_PUBLIC_KEY_BYTES = 32;

function assertPublicKey(publicKey32: Uint8Array): void {
  if (!(publicKey32 instanceof Uint8Array) || publicKey32.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new TypeError('publicKey32 must be a 32-byte Ed25519 public key');
  }
}

/** Mirrors the Move checks so the wallet never signs a transaction that is certain to abort. */
function assertLabel(label: string): void {
  const bytes = new TextEncoder().encode(label).length;
  if (bytes === 0 || bytes > MEMWAL_MAX_LABEL_BYTES) {
    throw new RangeError(`label must be 1 to ${MEMWAL_MAX_LABEL_BYTES} UTF-8 bytes`);
  }
}

/** `create_account(registry: &mut AccountRegistry, clock: &Clock, ctx)` */
export function buildCreateAccountTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: MEMWAL_TARGETS.createAccount,
    arguments: [tx.object(MEMWAL_REGISTRY_ID), tx.object(SUI_CLOCK_ID)],
  });
  return tx;
}

export interface AddDelegateKeyInput {
  accountId: string;
  publicKey32: Uint8Array;
  label: string;
}

/** `add_delegate_key(account, registry, public_key: vector<u8>, label: String, clock, ctx)` */
export function buildAddDelegateKeyTx(input: AddDelegateKeyInput): Transaction {
  assertPublicKey(input.publicKey32);
  assertLabel(input.label);
  const tx = new Transaction();
  tx.moveCall({
    target: MEMWAL_TARGETS.addDelegateKey,
    arguments: [
      tx.object(normalizeAddress(input.accountId)),
      tx.object(MEMWAL_REGISTRY_ID),
      tx.pure.vector('u8', Array.from(input.publicKey32)),
      tx.pure.string(input.label),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  return tx;
}

export interface RemoveDelegateKeyInput {
  accountId: string;
  publicKey32: Uint8Array;
}

/** `remove_delegate_key(account, registry, public_key: vector<u8>, ctx)`: no Clock argument. */
export function buildRemoveDelegateKeyTx(input: RemoveDelegateKeyInput): Transaction {
  assertPublicKey(input.publicKey32);
  const tx = new Transaction();
  tx.moveCall({
    target: MEMWAL_TARGETS.removeDelegateKey,
    arguments: [
      tx.object(normalizeAddress(input.accountId)),
      tx.object(MEMWAL_REGISTRY_ID),
      tx.pure.vector('u8', Array.from(input.publicKey32)),
    ],
  });
  return tx;
}
export * from './sponsor.js';
