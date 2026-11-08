import { MemWalRateLimitedError, isTimeoutError } from '@mysten-incubation/memwal';
import { systemClock, type Clock } from './types.js';

/** Operations the client spends relayer points on. */
export type OpKind = 'bulk' | 'remember' | 'manual' | 'recall' | 'status' | 'list';

/**
 * Relayer endpoint weights (RESEARCH 1.2, `rate_limit.rs`): `/api/remember/bulk` 10 per request
 * whatever the item count, `/api/remember` 5, `/api/remember/manual` 3 (Vault mode), recall and
 * status polls 1. `list` is the
 * `/v1/owners/...` read API, which has its own 200 per minute bucket.
 */
export const OP_WEIGHTS: Readonly<Record<OpKind, number>> = { bulk: 10, remember: 5, manual: 3, recall: 1, status: 1, list: 1 };

export interface GovernorConfig {
  /** Per delegate key. The relayer allows 30 per minute; the gap is headroom for clock skew. */
  keyBudgetPerMinute: number;
  /** Recall share of the key budget. Clamped so one bulk write always fits beside it. */
  recallBudgetPerMinute: number;
  /** Per account sustained. The relayer allows 500 per hour. */
  accountBudgetPerHour: number;
  listBudgetPerMinute: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Used when a 429 carries no Retry-After. */
  defaultRateLimitWaitMs: number;
  /** Used when a 503 AUTH_UPSTREAM_UNAVAILABLE carries no Retry-After (relayer sends 5). */
  defaultUpstreamWaitMs: number;
  /** Waits for tokens at least this long are reported to the UI as cooling down. */
  reportPacingAfterMs: number;
}

export const DEFAULT_GOVERNOR_CONFIG: Readonly<GovernorConfig> = {
  keyBudgetPerMinute: 26,
  recallBudgetPerMinute: 16,
  accountBudgetPerHour: 480,
  listBudgetPerMinute: 180,
  maxAttempts: 5,
  baseBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  defaultRateLimitWaitMs: 60_000,
  defaultUpstreamWaitMs: 5_000,
  reportPacingAfterMs: 2_000,
};

export type CoolingReason = 'rate_limited' | 'upstream_unavailable' | 'pacing';

export type GovernorState =
  | { kind: 'ready' }
  | { kind: 'cooling_down'; reason: CoolingReason; resumeAt: number }
  | { kind: 'key_rejected' };

export class CoolingDownError extends Error {
  override readonly name = 'CoolingDownError';
  constructor(
    readonly resumeAt: number,
    readonly reason: CoolingReason,
  ) {
    super(`Walrus Memory is cooling down (${reason}) until ${new Date(resumeAt).toISOString()}`);
  }
}

export class KeyRejectedError extends Error {
  override readonly name = 'KeyRejectedError';
  constructor() {
    super('The relayer rejected this delegate key twice. Re-check it on chain or pair again.');
  }
}

export class ClockDriftError extends Error {
  override readonly name = 'ClockDriftError';
  constructor() {
    super('This device clock is more than five minutes off. Fix the system time and retry.');
  }
}

type Classified =
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'upstream'; retryAfterMs: number | null }
  | { kind: 'auth_rejected' }
  | { kind: 'clock_drift' }
  | { kind: 'transient' }
  | { kind: 'fatal' };

interface HttpishError {
  status?: unknown;
  serverCode?: unknown;
  retryAfterSeconds?: unknown;
}

function retryAfterMs(err: HttpishError): number | null {
  const s = err.retryAfterSeconds;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null;
}

/** Maps SDK errors (see `signedRequest` in dist/memwal.js) onto a retry policy. */
export function classifyError(err: unknown): Classified {
  if (err instanceof MemWalRateLimitedError) {
    return { kind: 'rate_limited', retryAfterMs: err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : null };
  }
  if (!(err instanceof Error)) return { kind: 'fatal' };
  const e: Error & HttpishError = err;
  if (e.name === 'AbortError') return { kind: 'fatal' };
  if (isTimeoutError(err)) return { kind: 'transient' };
  const status = typeof e.status === 'number' ? e.status : null;
  const code = typeof e.serverCode === 'string' ? e.serverCode : null;
  if (code === 'ERR_TIMESTAMP_OUT_OF_BOUNDS') return { kind: 'clock_drift' };
  if (status === 429) return { kind: 'rate_limited', retryAfterMs: retryAfterMs(e) };
  if (code === 'AUTH_UPSTREAM_UNAVAILABLE' || status === 503) return { kind: 'upstream', retryAfterMs: retryAfterMs(e) };
  if (status === 401) return { kind: 'auth_rejected' };
  if (status === 500 || status === 502 || status === 504) return { kind: 'transient' };
  // fetch rejects with a bare TypeError on network failure.
  if (status === null && e instanceof TypeError) return { kind: 'transient' };
  return { kind: 'fatal' };
}

class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    readonly capacity: number,
    private readonly windowMs: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }
  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.last);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / this.windowMs);
    this.last = now;
  }
  waitMs(n: number, now: number): number {
    this.refill(now);
    if (this.tokens >= n) return 0;
    return Math.ceil(((n - this.tokens) * this.windowMs) / this.capacity);
  }
  take(n: number, now: number): void {
    this.refill(now);
    this.tokens -= n;
  }
  drain(now: number): void {
    this.refill(now);
    this.tokens = Math.min(this.tokens, 0);
  }
  level(now: number): number {
    this.refill(now);
    return this.tokens;
  }
}

export interface RunOptions {
  /** When false, throw `CoolingDownError` instead of waiting (composer recalls must not stall). */
  wait?: boolean;
  signal?: AbortSignal;
  maxAttempts?: number;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * Client side mirror of the relayer limits. Every relayer call goes through `run`, which waits
 * for budget, classifies failures and retries the ones that are safe to retry. Writes are safe to
 * retry because every batch carries a content derived idempotency key.
 */
export class RateGovernor {
  readonly config: Readonly<GovernorConfig>;
  private readonly key: TokenBucket;
  private readonly recall: TokenBucket;
  private readonly account: TokenBucket;
  private readonly list: TokenBucket;
  private coolingUntil = 0;
  private coolingReason: CoolingReason = 'pacing';
  private rejected = false;
  private current: GovernorState = { kind: 'ready' };
  private readonly listeners = new Set<(s: GovernorState) => void>();

  constructor(
    config: Partial<GovernorConfig> = {},
    private readonly clock: Clock = systemClock,
    private readonly random: () => number = Math.random,
  ) {
    const merged = { ...DEFAULT_GOVERNOR_CONFIG, ...config };
    if (merged.keyBudgetPerMinute < OP_WEIGHTS.bulk) {
      throw new RangeError(`keyBudgetPerMinute must be at least ${OP_WEIGHTS.bulk} so a bulk write can ever run`);
    }
    // Recall shares the key bucket with writes; capping it leaves room for one bulk per window.
    merged.recallBudgetPerMinute = Math.max(1, Math.min(merged.recallBudgetPerMinute, merged.keyBudgetPerMinute - OP_WEIGHTS.bulk));
    this.config = merged;
    const now = clock.now();
    this.key = new TokenBucket(merged.keyBudgetPerMinute, MINUTE, now);
    this.recall = new TokenBucket(merged.recallBudgetPerMinute, MINUTE, now);
    this.account = new TokenBucket(merged.accountBudgetPerHour, HOUR, now);
    this.list = new TokenBucket(merged.listBudgetPerMinute, MINUTE, now);
  }

  get state(): GovernorState {
    return this.current;
  }

  subscribe(listener: (s: GovernorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Call after the user re-pairs or the key is confirmed on chain again. */
  clearKeyRejected(): void {
    this.rejected = false;
    this.setState({ kind: 'ready' });
  }

  /** Remaining points per bucket, for diagnostics and tests. */
  levels(): { key: number; recall: number; account: number; list: number } {
    const now = this.clock.now();
    return { key: this.key.level(now), recall: this.recall.level(now), account: this.account.level(now), list: this.list.level(now) };
  }

  private setState(next: GovernorState): void {
    const prev = this.current;
    const same =
      prev.kind === next.kind &&
      (prev.kind !== 'cooling_down' || (next.kind === 'cooling_down' && prev.resumeAt === next.resumeAt && prev.reason === next.reason));
    if (same) return;
    this.current = next;
    for (const l of this.listeners) l(next);
  }

  private bucketsFor(kind: OpKind): TokenBucket[] {
    if (kind === 'list') return [this.list];
    if (kind === 'recall') return [this.recall, this.key, this.account];
    return [this.key, this.account];
  }

  private coolDown(until: number, reason: CoolingReason): void {
    if (until > this.coolingUntil) {
      this.coolingUntil = until;
      this.coolingReason = reason;
    }
    this.setState({ kind: 'cooling_down', reason: this.coolingReason, resumeAt: this.coolingUntil });
  }

  async acquire(kind: OpKind, opts: RunOptions = {}): Promise<void> {
    const wait = opts.wait ?? true;
    const weight = OP_WEIGHTS[kind];
    for (;;) {
      opts.signal?.throwIfAborted();
      if (this.rejected) throw new KeyRejectedError();
      const now = this.clock.now();
      if (this.coolingUntil > now && kind !== 'list') {
        if (!wait) throw new CoolingDownError(this.coolingUntil, this.coolingReason);
        this.setState({ kind: 'cooling_down', reason: this.coolingReason, resumeAt: this.coolingUntil });
        await this.clock.sleep(this.coolingUntil - now, opts.signal);
        continue;
      }
      const buckets = this.bucketsFor(kind);
      const waitMs = Math.max(...buckets.map((b) => b.waitMs(weight, now)));
      if (waitMs === 0) {
        for (const b of buckets) b.take(weight, now);
        if (this.current.kind === 'cooling_down' && this.coolingUntil <= now) this.setState({ kind: 'ready' });
        return;
      }
      if (!wait) throw new CoolingDownError(now + waitMs, 'pacing');
      if (waitMs >= this.config.reportPacingAfterMs) {
        this.setState({ kind: 'cooling_down', reason: 'pacing', resumeAt: now + waitMs });
      }
      await this.clock.sleep(waitMs, opts.signal);
    }
  }

  private backoffMs(attempt: number): number {
    const ceiling = Math.min(this.config.maxBackoffMs, this.config.baseBackoffMs * 2 ** attempt);
    // Full jitter: spreads retries from several tabs or devices sharing one account.
    return Math.max(1, Math.round(ceiling * this.random()));
  }

  async run<T>(kind: OpKind, fn: () => Promise<T>, opts: RunOptions = {}): Promise<T> {
    const wait = opts.wait ?? true;
    const maxAttempts = opts.maxAttempts ?? this.config.maxAttempts;
    let authRetried = false;
    for (let attempt = 0; ; attempt++) {
      await this.acquire(kind, opts);
      try {
        const result = await fn();
        if (this.current.kind === 'cooling_down' && this.coolingUntil <= this.clock.now()) this.setState({ kind: 'ready' });
        return result;
      } catch (err) {
        const c = classifyError(err);
        const now = this.clock.now();
        if (c.kind === 'fatal') throw err;
        if (c.kind === 'clock_drift') throw new ClockDriftError();
        if (c.kind === 'auth_rejected') {
          if (authRetried) {
            this.rejected = true;
            this.setState({ kind: 'key_rejected' });
            throw new KeyRejectedError();
          }
          authRetried = true;
        }
        if (c.kind === 'rate_limited') {
          for (const b of this.bucketsFor(kind)) b.drain(now);
          this.coolDown(now + (c.retryAfterMs ?? this.config.defaultRateLimitWaitMs), 'rate_limited');
        } else if (c.kind === 'upstream') {
          this.coolDown(now + (c.retryAfterMs ?? this.config.defaultUpstreamWaitMs), 'upstream_unavailable');
        }
        if (attempt + 1 >= maxAttempts) throw err;
        if (!wait && (c.kind === 'rate_limited' || c.kind === 'upstream')) {
          throw new CoolingDownError(this.coolingUntil, this.coolingReason);
        }
        if (c.kind === 'transient' || c.kind === 'auth_rejected') {
          await this.clock.sleep(this.backoffMs(attempt), opts.signal);
        }
      }
    }
  }
}
