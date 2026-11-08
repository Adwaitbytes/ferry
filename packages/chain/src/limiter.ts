import { systemClock, type Clock } from './clock.js';

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super('rate limited');
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface TokenBucketOptions {
  /** Tokens added per second. */
  ratePerSec: number;
  /** Maximum stored tokens, i.e. the largest burst. */
  capacity: number;
  /** A caller that would wait longer than this is rejected instead of queued. */
  maxWaitMs?: number;
  clock?: Clock;
}

/**
 * Reservation-style token bucket: a caller takes its token immediately (the balance may go
 * negative) and sleeps until the balance it borrowed against has refilled. Concurrent callers
 * therefore queue in arrival order without an explicit queue.
 */
export class TokenBucket {
  readonly #rate: number;
  readonly #capacity: number;
  readonly #maxWaitMs: number;
  readonly #clock: Clock;
  #tokens: number;
  #updatedAt: number;

  constructor(options: TokenBucketOptions) {
    if (!(options.ratePerSec > 0) || !(options.capacity >= 1)) throw new RangeError('invalid token bucket');
    this.#rate = options.ratePerSec;
    this.#capacity = options.capacity;
    this.#maxWaitMs = options.maxWaitMs ?? Number.POSITIVE_INFINITY;
    this.#clock = options.clock ?? systemClock;
    this.#tokens = options.capacity;
    this.#updatedAt = this.#clock.now();
  }

  #refill(): void {
    const now = this.#clock.now();
    const elapsed = Math.max(0, now - this.#updatedAt);
    this.#tokens = Math.min(this.#capacity, this.#tokens + (elapsed * this.#rate) / 1000);
    this.#updatedAt = now;
  }

  /** Milliseconds until one token would be available, without taking it. */
  waitMs(): number {
    this.#refill();
    return this.#tokens >= 1 ? 0 : Math.ceil(((1 - this.#tokens) * 1000) / this.#rate);
  }

  /** Non-blocking take for per-client limits: either a token now, or a retry hint. */
  tryTake(): { ok: true } | { ok: false; retryAfterMs: number } {
    const wait = this.waitMs();
    if (wait > 0) return { ok: false, retryAfterMs: wait };
    this.#tokens -= 1;
    return { ok: true };
  }

  /** Blocking take for the upstream budget; throws RateLimitedError past `maxWaitMs`. */
  async take(): Promise<void> {
    const wait = this.waitMs();
    if (wait > this.#maxWaitMs) throw new RateLimitedError(wait);
    this.#tokens -= 1;
    if (wait > 0) await this.#clock.sleep(wait);
  }
}

/**
 * One bucket per key (client IP) with a hard cap on tracked keys, so a flood of spoofed or
 * rotating keys cannot grow memory without bound. Idle buckets are full anyway, so evicting the
 * oldest is equivalent to forgetting a client that has fully recovered.
 */
export class KeyedRateLimiter {
  readonly #options: TokenBucketOptions;
  readonly #maxKeys: number;
  readonly #buckets = new Map<string, TokenBucket>();

  constructor(options: TokenBucketOptions & { maxKeys?: number }) {
    this.#options = options;
    this.#maxKeys = options.maxKeys ?? 10_000;
  }

  check(key: string): { ok: true } | { ok: false; retryAfterMs: number } {
    let bucket = this.#buckets.get(key);
    if (bucket) {
      this.#buckets.delete(key);
    } else {
      bucket = new TokenBucket(this.#options);
      if (this.#buckets.size >= this.#maxKeys) {
        const oldest = this.#buckets.keys().next();
        if (!oldest.done) this.#buckets.delete(oldest.value);
      }
    }
    this.#buckets.set(key, bucket);
    return bucket.tryTake();
  }

  get size(): number {
    return this.#buckets.size;
  }
}
