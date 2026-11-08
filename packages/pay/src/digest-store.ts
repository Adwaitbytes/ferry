import type { DigestStore } from '@suimpp/mpp/server';
import type { PayFailure } from './errors.js';
import type { PayStore } from './store.js';
import type { VerifiedPayment } from './verify-payment.js';

/**
 * Thrown from `set` so the suimpp verifier aborts and mppx answers 402; the Gate reads the
 * real outcome from `BoundDigestStore.outcome` and answers with the right status.
 */
export class DigestRejectedError extends Error {
  constructor(readonly failure: PayFailure) {
    super(`payment rejected: ${failure.code}`);
    this.name = 'DigestRejectedError';
  }
}

/**
 * The suimpp `DigestStore`, bound to one request. The library's interface is has-then-set, a
 * read-then-write that two racing requests could both pass, so `has` is only a fast path and
 * `set` is the atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING` (via `commit`). Binding to
 * the request lets the row carry card, payer, amount and query hash, which `set(digest)` alone
 * could not.
 */
export class BoundDigestStore implements DigestStore {
  outcome: VerifiedPayment | PayFailure | null = null;
  /** The digest the library asked about, so a refusal before set() can still be classified. */
  seen: string | null = null;

  constructor(
    private readonly store: PayStore,
    private readonly commit: (digest: string) => Promise<VerifiedPayment | PayFailure>,
  ) {}

  has(digest: string): Promise<boolean> {
    this.seen = digest;
    return this.store.isDigestUsed(digest);
  }

  async set(digest: string): Promise<void> {
    this.outcome = await this.commit(digest);
    if (!this.outcome.ok) throw new DigestRejectedError(this.outcome);
  }
}

/** Classifies a refusal that happened before set(): a replay if the digest is already committed. */
export async function refusalOf(bound: BoundDigestStore, store: PayStore): Promise<PayFailure> {
  if (bound.outcome && !bound.outcome.ok) return bound.outcome;
  const replayed = bound.seen !== null && (await store.isDigestUsed(bound.seen));
  return { ok: false, ...(replayed ? { status: 409, code: 'PAYMENT_REPLAYED' } : { status: 402, code: 'PAYMENT_UNVERIFIED' }) };
}
