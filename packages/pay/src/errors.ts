import type { VerifyFailure } from './verifier.js';

/** HTTP statuses and reason codes are binding (REDTEAM 1). */
export const PAY_ERRORS = {
  INVALID_CARD_ID: 400,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  PAYMENT_INVALID: 402,
  CHALLENGE_MISMATCH: 402,
  PAYMENT_NOT_BOUND: 402,
  PAYMENT_NOT_FOUND: 402,
  PAYMENT_FAILED: 402,
  PAYMENT_PENDING: 402,
  PAYMENT_EXPIRED: 402,
  PAYMENT_UNDERPAID: 402,
  PAYMENT_WRONG_COIN: 402,
  PAYMENT_WRONG_RECIPIENT: 402,
  PAYMENT_UNVERIFIED: 402,
  AGENT_NOT_ALLOWED: 403,
  PAYMENT_REPLAYED: 409,
  DAILY_CAP: 429,
  RATE_LIMITED: 429,
} as const;

export type PayErrorCode = keyof typeof PAY_ERRORS;
export type PayErrorStatus = (typeof PAY_ERRORS)[PayErrorCode];

export interface PayFailure {
  ok: false;
  status: PayErrorStatus;
  code: PayErrorCode;
}

export function payFailure(code: PayErrorCode): PayFailure {
  return { ok: false, status: PAY_ERRORS[code], code };
}

const FROM_VERIFIER: Record<VerifyFailure, PayErrorCode> = {
  NOT_FOUND: 'PAYMENT_NOT_FOUND',
  FAILED: 'PAYMENT_FAILED',
  WRONG_COIN: 'PAYMENT_WRONG_COIN',
  UNDERPAID: 'PAYMENT_UNDERPAID',
  WRONG_RECIPIENT: 'PAYMENT_WRONG_RECIPIENT',
  EXPIRED: 'PAYMENT_EXPIRED',
  NOT_FINAL: 'PAYMENT_PENDING',
};

export function fromVerifierFailure(reason: VerifyFailure): PayFailure {
  return payFailure(FROM_VERIFIER[reason]);
}
