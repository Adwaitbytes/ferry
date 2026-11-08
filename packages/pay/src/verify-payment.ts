import { isValidPersonalMessageSignature } from '@mysten/sui/verify';
import { CLOCK_SKEW_MS, MAINNET_USDC_TYPE, PRESENTATION_GRACE_MS, SHA256_HEX_RE } from './constants.js';
import { fromVerifierFailure, payFailure, type PayFailure } from './errors.js';
import { newReceiptId } from './hash.js';
import { normalizeAddress } from './normalize.js';
import { digestBindingMessage, mppProofMessage, type MppProofChallenge } from './proof.js';
import type { Card, PayStore, StoredChallenge } from './store.js';
import type { PaymentVerifier } from './verifier.js';

/** Sui transaction digests are base58 of 32 bytes. */
const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

/**
 * How the request proves the payment belongs to it (X-PAY-1). A bare digest is never enough:
 * anyone watching the chain can see a transfer to the card owner.
 */
export type PaymentProof =
  /** MPP credential: the sender signed the suimpp proof message over this challenge and digest. */
  | { kind: 'mpp'; digest: string; signature: string; challenge: MppProofChallenge }
  /** A digest plus a sender signature over `ferry-gate:v1:<cardId>:<challengeId>:<digest>`. */
  | { kind: 'digest'; digest: string; signature?: string }
  /** x402: the Gate executed the payer-signed bytes in this request, so the digest was born here. */
  | { kind: 'settled'; digest: string };

export interface VerifyInput {
  challengeId: string;
  proof: PaymentProof;
  /** The card the request targets, loaded by id from the database. */
  card: Card | null;
  querySha256: string;
  nowMs: number;
}

export interface VerifyDeps {
  store: PayStore;
  verifier: PaymentVerifier;
  coinType?: string;
}

export interface CheckedPayment {
  ok: true;
  card: Card;
  challenge: StoredChallenge;
  digest: string;
  payer: string;
  amountMicros: bigint;
  dialect: 'mpp' | 'x402';
  querySha256: string;
}

export interface VerifiedPayment {
  ok: true;
  receiptId: string;
  digest: string;
  payer: string;
  amountMicros: bigint;
}

async function signedBy(message: Uint8Array, signature: string, address: string): Promise<boolean> {
  try {
    return await isValidPersonalMessageSignature(message, signature, { address });
  } catch {
    return false;
  }
}

/**
 * Every check that does not write. Runs before any library verification so a bad proof costs
 * no fullnode call and never touches the replay table.
 */
export async function checkPayment(input: VerifyInput, deps: VerifyDeps): Promise<CheckedPayment | PayFailure> {
  const { card, proof, nowMs } = input;
  if (!card || card.killed || !card.enabled) return payFailure('NOT_FOUND');
  if (!DIGEST_RE.test(proof.digest) || !SHA256_HEX_RE.test(input.querySha256)) return payFailure('PAYMENT_INVALID');

  const challenge = await deps.store.getChallenge(input.challengeId);
  if (
    !challenge ||
    challenge.cardId !== card.id ||
    challenge.priceMicros !== card.priceMicros ||
    challenge.recipient !== normalizeAddress(card.ownerAddress)
  ) {
    return payFailure('CHALLENGE_MISMATCH');
  }
  if (nowMs > challenge.expiresAtMs + PRESENTATION_GRACE_MS) return payFailure('PAYMENT_EXPIRED');
  if (proof.kind === 'digest' && proof.signature === undefined) return payFailure('PAYMENT_NOT_BOUND');
  if (proof.kind === 'mpp' && proof.challenge.id !== challenge.id) return payFailure('PAYMENT_NOT_BOUND');
  if (await deps.store.isDigestUsed(proof.digest)) return payFailure('PAYMENT_REPLAYED');

  const verified = await deps.verifier.verify({
    digest: proof.digest,
    recipient: challenge.recipient,
    coinType: deps.coinType ?? MAINNET_USDC_TYPE,
    minAmountMicros: challenge.priceMicros,
    notBeforeMs: challenge.issuedAtMs - CLOCK_SKEW_MS,
    notAfterMs: challenge.expiresAtMs,
  });
  if (!verified.ok) return fromVerifierFailure(verified.reason);

  if (proof.kind === 'mpp' && !(await signedBy(mppProofMessage(proof.challenge, proof.digest), proof.signature, verified.sender))) {
    return payFailure('PAYMENT_NOT_BOUND');
  }
  if (
    proof.kind === 'digest' &&
    !(await signedBy(digestBindingMessage(card.id, challenge.id, proof.digest), proof.signature ?? '', verified.sender))
  ) {
    return payFailure('PAYMENT_NOT_BOUND');
  }

  // Compared with the transaction sender from effects, never a header the agent supplies.
  if (card.allowedAgents.length > 0 && !card.allowedAgents.map(normalizeAddress).includes(verified.sender)) {
    return payFailure('AGENT_NOT_ALLOWED');
  }

  return {
    ok: true,
    card,
    challenge,
    digest: proof.digest,
    payer: verified.sender,
    amountMicros: verified.amountMicros,
    dialect: proof.kind === 'settled' ? 'x402' : 'mpp',
    querySha256: input.querySha256,
  };
}

/** The replay gate. Zero rows from the unique insert means the digest or challenge was used. */
export async function commitPayment(checked: CheckedPayment, store: PayStore, nowMs: number): Promise<VerifiedPayment | PayFailure> {
  const receiptId = newReceiptId();
  const inserted = await store.commitPayment({
    receiptId,
    digest: checked.digest,
    challengeId: checked.challenge.id,
    cardId: checked.card.id,
    payer: checked.payer,
    amountMicros: checked.amountMicros,
    querySha256: checked.querySha256,
    dialect: checked.dialect,
  });
  if (!inserted) return payFailure('PAYMENT_REPLAYED');
  await store.incrementDaily(checked.card.id, nowMs);
  return { ok: true, receiptId, digest: checked.digest, payer: checked.payer, amountMicros: checked.amountMicros };
}

/** REDTEAM harness contract: check, then commit. Recall may run only on `ok: true`. */
export async function verifyPayment(input: VerifyInput, deps: VerifyDeps): Promise<VerifiedPayment | PayFailure> {
  const checked = await checkPayment(input, deps);
  if (!checked.ok) return checked;
  return commitPayment(checked, deps.store, input.nowMs);
}
