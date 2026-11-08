import { normalizeAddress, normalizeCoinType, tryNormalizeAddress } from './normalize.js';

/** Reason codes shared with `verifyUsdcPayment` in packages/chain. */
export const VERIFY_FAILURES = ['NOT_FOUND', 'FAILED', 'WRONG_COIN', 'UNDERPAID', 'WRONG_RECIPIENT', 'EXPIRED', 'NOT_FINAL'] as const;
export type VerifyFailure = (typeof VERIFY_FAILURES)[number];

export interface PaymentVerificationRequest {
  digest: string;
  /** Card owner, taken from the database, never from the request (RT-46). */
  recipient: string;
  coinType: string;
  minAmountMicros: bigint;
  /** Checkpoint timestamp must be >= this (challenge issuedAt minus clock skew). */
  notBeforeMs: number;
  /** Checkpoint timestamp must be <= this (challenge expiry). */
  notAfterMs: number;
}

export type PaymentVerification =
  | { ok: true; sender: string; amountMicros: bigint; checkpoint: bigint; timestampMs: number }
  | { ok: false; reason: VerifyFailure };

/**
 * The Gate's view of "is this digest a finalized USDC payment to the card owner". Injected so
 * packages/pay does not depend on how the transaction is fetched (Tatum gRPC in production).
 */
export interface PaymentVerifier {
  verify(request: PaymentVerificationRequest): Promise<PaymentVerification>;
}

/** Normalized transaction effects, the shape packages/chain produces from Tatum GetTransaction. */
export interface NormalizedTransaction {
  digest: string;
  status: 'success' | 'failure';
  sender: string;
  /** null until the transaction is in a checkpoint. */
  checkpoint: bigint | null;
  timestampMs: number | null;
  balanceChanges: readonly { owner: string; coinType: string; amount: bigint }[];
}

/**
 * Applies the THREAT_MODEL 11 rules to transaction effects. Only positive changes to the
 * recipient in the exact coin type count; absolute values are never used (RT-47).
 */
export function evaluateTransaction(tx: NormalizedTransaction | null, request: PaymentVerificationRequest): PaymentVerification {
  if (tx === null) return { ok: false, reason: 'NOT_FOUND' };
  if (tx.status !== 'success') return { ok: false, reason: 'FAILED' };
  if (tx.checkpoint === null || tx.timestampMs === null) return { ok: false, reason: 'NOT_FINAL' };
  if (tx.timestampMs < request.notBeforeMs || tx.timestampMs > request.notAfterMs) return { ok: false, reason: 'EXPIRED' };

  const recipient = normalizeAddress(request.recipient);
  const coinType = normalizeCoinType(request.coinType);
  let paid = 0n;
  let recipientTouchedInCoin = false;
  let recipientGotOtherCoin = false;
  let someoneElseGotCoin = false;
  for (const change of tx.balanceChanges) {
    const owner = tryNormalizeAddress(change.owner);
    const sameCoin = coinType !== null && normalizeCoinType(change.coinType) === coinType;
    if (owner === recipient && sameCoin) {
      recipientTouchedInCoin = true;
      if (change.amount > 0n) paid += change.amount;
    } else if (owner === recipient && change.amount > 0n) {
      recipientGotOtherCoin = true;
    } else if (sameCoin && change.amount > 0n) {
      someoneElseGotCoin = true;
    }
  }

  if (paid >= request.minAmountMicros && paid > 0n) {
    const sender = tryNormalizeAddress(tx.sender);
    if (sender === null) return { ok: false, reason: 'FAILED' };
    return { ok: true, sender, amountMicros: paid, checkpoint: tx.checkpoint, timestampMs: tx.timestampMs };
  }
  if (paid > 0n || recipientTouchedInCoin) return { ok: false, reason: 'UNDERPAID' };
  if (recipientGotOtherCoin) return { ok: false, reason: 'WRONG_COIN' };
  if (someoneElseGotCoin) return { ok: false, reason: 'WRONG_RECIPIENT' };
  return { ok: false, reason: 'UNDERPAID' };
}

/** Builds a verifier from any transaction fetcher. Used with a fake client in tests. */
export function transactionVerifier(fetchTransaction: (digest: string) => Promise<NormalizedTransaction | null>): PaymentVerifier {
  return {
    async verify(request) {
      return evaluateTransaction(await fetchTransaction(request.digest), request);
    },
  };
}

/**
 * Sui checkpoints land within a second or two, but Tatum can trail the fullnode the payer
 * submitted to. Retrying NOT_FOUND and NOT_FINAL briefly keeps an honest agent from paying and
 * then being told "pending"; everything else is final and returns at once.
 */
export function withFinalityRetry(
  verifier: PaymentVerifier,
  options: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> },
): PaymentVerifier {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async verify(request) {
      let result = await verifier.verify(request);
      for (let attempt = 1; attempt < options.attempts; attempt++) {
        if (result.ok || (result.reason !== 'NOT_FINAL' && result.reason !== 'NOT_FOUND')) return result;
        await sleep(options.delayMs * attempt);
        result = await verifier.verify(request);
      }
      return result;
    },
  };
}
