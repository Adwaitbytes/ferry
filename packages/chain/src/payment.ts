import { isValidTransactionDigest } from '@mysten/sui/utils';
import { USDC_COIN_TYPE } from './constants.js';
import { normalizeAddress, normalizeCoinType } from './address.js';
import { ChainDataError, type PaymentTransaction, type TatumSui } from './rpc.js';

/**
 * Normalized view of a GetTransaction response, as consumed by packages/pay (REDTEAM section 1,
 * `BASE_TX`). Amounts are bigint; addresses and coin types are fully normalized.
 */
export interface NormalizedTransaction {
  digest: string;
  status: 'success' | 'failure';
  sender: string;
  /** `null` until the transaction is included in a checkpoint, which is Sui finality. */
  checkpoint: bigint | null;
  timestampMs: number | null;
  balanceChanges: { owner: string; coinType: string; amount: bigint }[];
}

export type PaymentFailureReason =
  | 'NOT_FOUND'
  | 'FAILED'
  | 'WRONG_COIN'
  | 'UNDERPAID'
  | 'WRONG_RECIPIENT'
  | 'EXPIRED'
  | 'NOT_FINAL';

export type PaymentVerification =
  | {
      ok: true;
      digest: string;
      payer: string;
      recipient: string;
      coinType: string;
      amountMicros: bigint;
      checkpoint: bigint;
      timestampMs: number;
    }
  | { ok: false; digest: string; reason: PaymentFailureReason };

export interface PaymentRequirement {
  recipient: string;
  minAmountMicros: bigint;
  /** Defaults to Mainnet USDC. Compared as a fully normalized struct tag, never by suffix. */
  coinType?: string;
  /** Inclusive window on the checkpoint timestamp. Gate passes `issuedAtMs - 30_000` and `expiresAtMs`. */
  notBeforeMs: number;
  notAfterMs: number;
}

export interface VerifyUsdcPaymentInput extends PaymentRequirement {
  digest: string;
}

const U64_MAX = (1n << 64n) - 1n;

function parseAmount(amount: string): bigint {
  if (!/^-?\d{1,40}$/.test(amount)) throw new ChainDataError('balance change amount is not an integer');
  return BigInt(amount);
}

export function normalizeTransaction(tx: PaymentTransaction): NormalizedTransaction {
  const sender = tx.transaction.sender;
  if (!sender) throw new ChainDataError('transaction has no sender');
  return {
    digest: tx.digest,
    status: tx.status.success ? 'success' : 'failure',
    sender: normalizeAddress(sender),
    checkpoint: tx.checkpoint === null ? null : BigInt(tx.checkpoint),
    timestampMs: tx.timestampMs,
    balanceChanges: tx.balanceChanges.map((change) => ({
      owner: normalizeAddress(change.address),
      coinType: normalizeCoinType(change.coinType),
      amount: parseAmount(change.amount),
    })),
  };
}

function assertRequirement(req: PaymentRequirement): void {
  if (typeof req.minAmountMicros !== 'bigint' || req.minAmountMicros <= 0n || req.minAmountMicros > U64_MAX) {
    throw new RangeError('minAmountMicros must be a positive u64 bigint');
  }
  if (!Number.isFinite(req.notBeforeMs) || !Number.isFinite(req.notAfterMs) || req.notBeforeMs > req.notAfterMs) {
    throw new RangeError('payment window is invalid');
  }
}

/**
 * Pure decision over a normalized transaction (threat model section 11, X-PAY-3). Order matters:
 * a failed or unfinalized transaction is reported as such before any amount check, and only
 * positive changes to the recipient in the exact coin type count toward the price.
 */
export function evaluatePayment(tx: NormalizedTransaction, req: PaymentRequirement): PaymentVerification {
  assertRequirement(req);
  const recipient = normalizeAddress(req.recipient);
  const coinType = normalizeCoinType(req.coinType ?? USDC_COIN_TYPE);
  const fail = (reason: PaymentFailureReason): PaymentVerification => ({ ok: false, digest: tx.digest, reason });

  if (tx.status !== 'success') return fail('FAILED');
  if (tx.checkpoint === null || tx.timestampMs === null) return fail('NOT_FINAL');
  if (tx.timestampMs < req.notBeforeMs || tx.timestampMs > req.notAfterMs) return fail('EXPIRED');

  const toRecipientInCoin = tx.balanceChanges.filter((c) => c.owner === recipient && c.coinType === coinType);
  const paid = toRecipientInCoin.reduce((sum, c) => (c.amount > 0n ? sum + c.amount : sum), 0n);

  if (paid >= req.minAmountMicros) {
    return {
      ok: true,
      digest: tx.digest,
      payer: tx.sender,
      recipient,
      coinType,
      amountMicros: paid,
      checkpoint: tx.checkpoint,
      timestampMs: tx.timestampMs,
    };
  }
  if (toRecipientInCoin.length > 0) return fail('UNDERPAID');
  if (tx.balanceChanges.some((c) => c.owner === recipient && c.amount > 0n)) return fail('WRONG_COIN');
  return fail('WRONG_RECIPIENT');
}

/** Reads the transaction through Tatum and evaluates it. Never throws for a bad digest. */
export async function verifyUsdcPayment(sui: TatumSui, input: VerifyUsdcPaymentInput): Promise<PaymentVerification> {
  assertRequirement(input);
  if (!isValidTransactionDigest(input.digest)) return { ok: false, digest: input.digest, reason: 'NOT_FOUND' };
  const tx = await sui.getTransaction(input.digest);
  if (!tx) return { ok: false, digest: input.digest, reason: 'NOT_FOUND' };
  return evaluatePayment(normalizeTransaction(tx), input);
}
