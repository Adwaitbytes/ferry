import { describe, expect, it, vi } from 'vitest';
import { KeyedRateLimiter, RateLimitedError, TokenBucket } from './limiter.js';
import { TtlCache } from './cache.js';
import { CreditMeter } from './meter.js';
import { isRetryable, withRetry } from './retry.js';
import { systemClock } from './clock.js';
import { fakeClock } from './fixtures.testutil.js';

describe('TokenBucket', () => {
  it('paces a 3 rps budget to one call per third of a second', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ ratePerSec: 3, capacity: 1, clock });
    const start = clock.now();
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(clock.sleeps).toEqual([334, 333]);
    expect(clock.now() - start).toBe(667);
  });

  it('queues concurrent callers in arrival order without exceeding the rate', async () => {
    const clock = fakeClock(0, { advanceOnSleep: false });
    const bucket = new TokenBucket({ ratePerSec: 3, capacity: 1, clock });
    await Promise.all([bucket.take(), bucket.take(), bucket.take(), bucket.take()]);
    expect(clock.sleeps).toEqual([334, 667, 1000]);
  });

  it('rejects callers that would wait past maxWaitMs', async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ ratePerSec: 1, capacity: 1, maxWaitMs: 500, clock });
    await bucket.take();
    const error = await bucket.take().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(1000);
  });

  it('tryTake never blocks and refills over time up to capacity', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ ratePerSec: 2, capacity: 2, clock });
    expect(bucket.tryTake()).toEqual({ ok: true });
    expect(bucket.tryTake()).toEqual({ ok: true });
    expect(bucket.tryTake()).toEqual({ ok: false, retryAfterMs: 500 });
    clock.advance(10_000);
    expect(bucket.waitMs()).toBe(0);
    expect(bucket.tryTake()).toEqual({ ok: true });
    expect(bucket.tryTake()).toEqual({ ok: true });
    expect(bucket.tryTake().ok).toBe(false);
  });

  it('rejects nonsense configuration', () => {
    expect(() => new TokenBucket({ ratePerSec: 0, capacity: 1 })).toThrow(RangeError);
    expect(() => new TokenBucket({ ratePerSec: 1, capacity: 0 })).toThrow(RangeError);
    expect(new TokenBucket({ ratePerSec: 1, capacity: 1 }).waitMs()).toBe(0);
  });
});

describe('KeyedRateLimiter', () => {
  it('limits each key independently', () => {
    const clock = fakeClock();
    const limiter = new KeyedRateLimiter({ ratePerSec: 1, capacity: 2, clock });
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a')).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(limiter.check('b').ok).toBe(true);
  });

  it('caps tracked keys by evicting the least recently seen', () => {
    const clock = fakeClock();
    const limiter = new KeyedRateLimiter({ ratePerSec: 1, capacity: 1, clock, maxKeys: 2 });
    limiter.check('a');
    limiter.check('b');
    limiter.check('a');
    limiter.check('c');
    expect(limiter.size).toBe(2);
    expect(limiter.check('a').ok).toBe(false);
    expect(limiter.check('b').ok).toBe(true);
  });
});

describe('TtlCache', () => {
  it('expires entries after the TTL and reports hits', async () => {
    const clock = fakeClock();
    const cache = new TtlCache<number>({ clock });
    const load = vi.fn(async () => 7);
    expect(await cache.getOrLoad('k', 15_000, load)).toEqual({ value: 7, hit: false });
    clock.advance(14_999);
    expect(await cache.getOrLoad('k', 15_000, load)).toEqual({ value: 7, hit: true });
    clock.advance(1);
    expect(cache.get('k')).toBeUndefined();
    expect(await cache.getOrLoad('k', 15_000, load)).toEqual({ value: 7, hit: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent readers', async () => {
    const cache = new TtlCache<string>({ clock: fakeClock() });
    let resolve: (v: string) => void = () => undefined;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const a = cache.getOrLoad('k', 1000, load);
    const b = cache.getOrLoad('k', 1000, load);
    resolve('v');
    expect(await a).toEqual({ value: 'v', hit: false });
    expect(await b).toEqual({ value: 'v', hit: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never caches failures', async () => {
    const cache = new TtlCache<string>({ clock: fakeClock() });
    await expect(cache.getOrLoad('k', 1000, async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await cache.getOrLoad('k', 1000, async () => 'ok')).toEqual({ value: 'ok', hit: false });
  });

  it('evicts the oldest entry at capacity and can be cleared', () => {
    const cache = new TtlCache<number>({ clock: fakeClock(), maxEntries: 2 });
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.set('b', 3, 1000);
    expect(cache.size).toBe(2);
    cache.set('c', 4, 1000);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(3);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(new TtlCache<number>().get('x')).toBeUndefined();
  });
});

describe('CreditMeter', () => {
  it('counts calls, credits, errors, retries and cache hits per method', () => {
    const meter = new CreditMeter(0);
    meter.call('GetObject', 2);
    meter.call('GetObject', 2);
    meter.cacheHit('GetObject');
    meter.error('GetTransaction');
    meter.retry('GetTransaction');
    meter.call('RateBySymbol', 20);
    expect(meter.snapshot()).toEqual({
      since: new Date(0).toISOString(),
      totalCalls: 3,
      totalCredits: 24,
      totalCacheHits: 1,
      totalErrors: 1,
      estimate: true,
      methods: {
        GetObject: { calls: 2, credits: 4, errors: 0, retries: 0, cacheHits: 1 },
        GetTransaction: { calls: 0, credits: 0, errors: 1, retries: 1, cacheHits: 0 },
        RateBySymbol: { calls: 1, credits: 20, errors: 0, retries: 0, cacheHits: 0 },
      },
    });
    meter.reset(5);
    expect(meter.snapshot().totalCalls).toBe(0);
    expect(meter.snapshot().since).toBe(new Date(5).toISOString());
    expect(new CreditMeter().snapshot().methods).toEqual({});
  });
});

describe('withRetry', () => {
  const grpc = (code: string) => Object.assign(new Error(`rpc ${code}`), { code });

  it('classifies retryable errors', () => {
    expect(isRetryable(grpc('UNAVAILABLE'))).toBe(true);
    expect(isRetryable(grpc('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isRetryable(grpc('DEADLINE_EXCEEDED'))).toBe(true);
    expect(isRetryable(grpc('UNAUTHENTICATED'))).toBe(false);
    expect(isRetryable(grpc('NOT_FOUND'))).toBe(false);
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable(new Error('Received HTTP status code 429'))).toBe(true);
    expect(isRetryable(new Error('nope'))).toBe(false);
    expect(isRetryable('string')).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });

  it('retries with exponential backoff and full jitter, then succeeds', async () => {
    const clock = fakeClock();
    const onRetry = vi.fn();
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw grpc('UNAVAILABLE');
        return 'ok';
      },
      { clock, random: () => 0.5, baseDelayMs: 100, maxDelayMs: 1000, onRetry },
    );
    expect(result).toBe('ok');
    expect(clock.sleeps).toEqual([50, 100]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('caps the delay and gives up after maxAttempts', async () => {
    const clock = fakeClock();
    const fn = vi.fn(async () => Promise.reject(grpc('RESOURCE_EXHAUSTED')));
    await expect(withRetry(fn, { clock, random: () => 0.999, baseDelayMs: 1000, maxDelayMs: 1500, maxAttempts: 4 })).rejects.toThrow(
      'RESOURCE_EXHAUSTED',
    );
    expect(fn).toHaveBeenCalledTimes(4);
    expect(clock.sleeps).toEqual([999, 1498, 1498]);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn(async () => Promise.reject(grpc('INVALID_ARGUMENT')));
    await expect(withRetry(fn, { clock: fakeClock() })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('system clock sleeps for real', async () => {
    const before = systemClock.now();
    await systemClock.sleep(5);
    expect(systemClock.now() - before).toBeGreaterThanOrEqual(4);
  });
});
