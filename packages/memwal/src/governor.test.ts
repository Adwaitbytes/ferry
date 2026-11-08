import { MemWalRateLimitedError } from '@mysten-incubation/memwal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClockDriftError,
  CoolingDownError,
  KeyRejectedError,
  RateGovernor,
  classifyError,
  type GovernorState,
} from './governor.js';
import { httpError, TestClock } from './test/fakes.js';
import { systemClock } from './types.js';

const ok = () => Promise.resolve('ok');

describe('classifyError', () => {
  it('maps SDK errors to retry kinds', () => {
    expect(classifyError(new MemWalRateLimitedError('x', ['j'], 7))).toEqual({ kind: 'rate_limited', retryAfterMs: 7000 });
    expect(classifyError(new MemWalRateLimitedError('x', ['j']))).toEqual({ kind: 'rate_limited', retryAfterMs: null });
    expect(classifyError(httpError(429, undefined, 12))).toEqual({ kind: 'rate_limited', retryAfterMs: 12000 });
    expect(classifyError(httpError(503, 'AUTH_UPSTREAM_UNAVAILABLE', 5))).toEqual({ kind: 'upstream', retryAfterMs: 5000 });
    expect(classifyError(httpError(401, 'AUTH_REJECTED'))).toEqual({ kind: 'auth_rejected' });
    expect(classifyError(httpError(401, 'ERR_TIMESTAMP_OUT_OF_BOUNDS'))).toEqual({ kind: 'clock_drift' });
    expect(classifyError(httpError(502))).toEqual({ kind: 'transient' });
    expect(classifyError(new TypeError('fetch failed'))).toEqual({ kind: 'transient' });
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError', phase: 'POST /api/recall' });
    expect(classifyError(timeout)).toEqual({ kind: 'transient' });
    expect(classifyError(new DOMException('a', 'AbortError'))).toEqual({ kind: 'fatal' });
    expect(classifyError(httpError(400))).toEqual({ kind: 'fatal' });
    expect(classifyError('nope')).toEqual({ kind: 'fatal' });
  });
});

describe('RateGovernor budgets', () => {
  it('lets two bulk writes through per minute under the 26 point budget, then paces', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({}, clock);
    const start = clock.now();
    await gov.run('bulk', ok);
    await gov.run('bulk', ok);
    expect(clock.now()).toBe(start);
    await gov.run('bulk', ok);
    // 6 points left, 4 more needed at 26 per minute.
    expect(clock.now() - start).toBe(Math.ceil((4 * 60_000) / 26));
  });

  it('caps recall so a bulk write always fits beside it', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({ recallBudgetPerMinute: 30 }, clock);
    expect(gov.config.recallBudgetPerMinute).toBe(16);
    for (let i = 0; i < 16; i++) await gov.run('recall', ok, { wait: false });
    await expect(gov.run('recall', ok, { wait: false })).rejects.toBeInstanceOf(CoolingDownError);
    const before = clock.now();
    await gov.run('bulk', ok);
    expect(clock.now()).toBe(before);
  });

  it('enforces the hourly account budget and keeps list on its own bucket', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({ accountBudgetPerHour: 20, keyBudgetPerMinute: 26 }, clock);
    await gov.run('bulk', ok);
    await gov.run('bulk', ok);
    for (let i = 0; i < 50; i++) await gov.run('list', ok);
    expect(clock.now()).toBe(new TestClock().now());
    const err = await gov.run('remember', ok, { wait: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolingDownError);
    expect((err as CoolingDownError).resumeAt - clock.now()).toBe(Math.ceil((5 * 3_600_000) / 20));
    expect(gov.levels().account).toBeCloseTo(0);
  });

  it('reports long pacing waits as cooling down and returns to ready', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({}, clock);
    const states: GovernorState[] = [];
    gov.subscribe((s) => states.push(s));
    await gov.run('bulk', ok);
    await gov.run('bulk', ok);
    await gov.run('bulk', ok);
    expect(states[0]).toMatchObject({ kind: 'cooling_down', reason: 'pacing' });
    expect(gov.state).toEqual({ kind: 'ready' });
  });

  it('rejects budgets that could never fit a bulk write', () => {
    expect(() => new RateGovernor({ keyBudgetPerMinute: 9 })).toThrow(RangeError);
  });
});

describe('RateGovernor failure handling', () => {
  it('cools down for Retry-After on 429, drains the bucket and retries', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({}, clock);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(httpError(429, undefined, 20)).mockResolvedValue('ok');
    const states: GovernorState[] = [];
    gov.subscribe((s) => states.push(s));
    const start = clock.now();
    await expect(gov.run('bulk', fn)).resolves.toBe('ok');
    expect(states[0]).toEqual({ kind: 'cooling_down', reason: 'rate_limited', resumeAt: start + 20_000 });
    expect(clock.now() - start).toBeGreaterThanOrEqual(20_000);
    expect(gov.state).toEqual({ kind: 'ready' });
  });

  it('uses the default wait when a 429 has no Retry-After, and handles MemWalRateLimitedError', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({ defaultRateLimitWaitMs: 45_000 }, clock);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(new MemWalRateLimitedError('polls', ['j1'], 3))
      .mockResolvedValue('ok');
    const start = clock.now();
    await gov.run('status', fn);
    expect(clock.now() - start).toBeGreaterThanOrEqual(45_000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('treats 503 AUTH_UPSTREAM_UNAVAILABLE as cooling down and throws CoolingDownError when not waiting', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({}, clock);
    const err = await gov.run('recall', () => Promise.reject(httpError(503, 'AUTH_UPSTREAM_UNAVAILABLE')), { wait: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolingDownError);
    expect(err).toMatchObject({ reason: 'upstream_unavailable', resumeAt: clock.now() + 5_000 });
    await expect(gov.run('recall', ok, { wait: false })).rejects.toBeInstanceOf(CoolingDownError);
    await expect(gov.run('recall', ok)).resolves.toBe('ok');
  });

  it('retries a 401 once, then surfaces key_rejected and refuses further calls', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({}, clock, () => 0.5);
    const flaky = vi.fn<() => Promise<string>>().mockRejectedValueOnce(httpError(401, 'AUTH_REJECTED')).mockResolvedValue('ok');
    await expect(gov.run('recall', flaky)).resolves.toBe('ok');
    const always = () => Promise.reject(httpError(401, 'AUTH_REJECTED'));
    await expect(gov.run('recall', always)).rejects.toBeInstanceOf(KeyRejectedError);
    expect(gov.state).toEqual({ kind: 'key_rejected' });
    await expect(gov.run('recall', ok)).rejects.toBeInstanceOf(KeyRejectedError);
    gov.clearKeyRejected();
    await expect(gov.run('recall', ok)).resolves.toBe('ok');
  });

  it('backs off exponentially with full jitter on timeouts and gives up after maxAttempts', async () => {
    const clock = new TestClock();
    const gov = new RateGovernor({ maxAttempts: 4, baseBackoffMs: 1_000 }, clock, () => 0.5);
    const timeout = Object.assign(new Error('slow'), { name: 'TimeoutError', phase: 'POST /api/remember/bulk' });
    const fn = vi.fn(() => Promise.reject(timeout));
    await expect(gov.run('status', fn)).rejects.toBe(timeout);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(clock.sleeps).toEqual([500, 1000, 2000]);
  });

  it('does not retry fatal errors and maps clock drift', async () => {
    const gov = new RateGovernor({}, new TestClock());
    const bad = httpError(400);
    const fn = vi.fn(() => Promise.reject(bad));
    await expect(gov.run('bulk', fn)).rejects.toBe(bad);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(gov.run('bulk', () => Promise.reject(httpError(401, 'ERR_TIMESTAMP_OUT_OF_BOUNDS')))).rejects.toBeInstanceOf(ClockDriftError);
  });

  it('stops waiting when the signal aborts', async () => {
    const gov = new RateGovernor({}, new TestClock());
    const ac = new AbortController();
    ac.abort();
    await expect(gov.run('bulk', ok, { signal: ac.signal })).rejects.toThrow();
  });
});

describe('systemClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('paces real time with fake timers', async () => {
    const gov = new RateGovernor({}, systemClock);
    await gov.run('bulk', ok);
    await gov.run('bulk', ok);
    let done = false;
    const third = gov.run('bulk', ok).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await third;
    expect(done).toBe(true);
  });

  it('sleep rejects on abort, before and during the wait', async () => {
    const ac = new AbortController();
    const pending = systemClock.sleep(10_000, ac.signal);
    ac.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    await expect(systemClock.sleep(5, ac.signal)).rejects.toThrow('stop');
    const plain = new AbortController();
    plain.abort();
    await expect(systemClock.sleep(5, plain.signal)).rejects.toThrow();
    const fine = systemClock.sleep(5);
    await vi.advanceTimersByTimeAsync(5);
    await expect(fine).resolves.toBeUndefined();
  });
});
