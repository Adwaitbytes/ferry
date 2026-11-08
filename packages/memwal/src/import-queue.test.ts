import type { ImportProgress } from '@ferry/core';
import { describe, expect, it } from 'vitest';
import type { FerryDb } from './db.js';
import { ImportQueue } from './import-queue.js';
import { FerryMemory } from './memory.js';
import { ACCOUNT, FakeRelayer, SEED, TestClock, fact, freshDb, httpError } from './test/fakes.js';

function build(db: FerryDb = freshDb(), clock = new TestClock(), relayer = new FakeRelayer(clock)) {
  const memory = new FerryMemory({ seed: SEED, accountId: ACCOUNT, serverUrl: 'https://relayer.memory.walrus.xyz', clock, client: relayer, db, random: () => 0.5 });
  return { memory, queue: new ImportQueue(memory, db), relayer, clock, db };
}

const facts = (n: number) => Array.from({ length: n }, (_, i) => fact({ text: `Imported fact ${i}` }));

describe('ImportQueue', () => {
  it('drains in paced batches of 20 and reports progress in the core shape', async () => {
    const { queue, relayer, clock } = build();
    const events: ImportProgress[] = [];
    queue.subscribe((p) => events.push(p));
    const all = facts(45);
    expect(await queue.enqueue(all)).toBe(45);
    expect(await queue.enqueue(all.slice(0, 5))).toBe(0);
    expect(await queue.progress()).toEqual({ total: 45, written: 0, failed: 0, state: 'idle' });
    const start = clock.now();
    await queue.start();
    expect(relayer.bulkSizes).toEqual([20, 20, 5]);
    // Third bulk had to wait for the per-key budget to refill.
    expect(clock.now() - start).toBeGreaterThan(9_000);
    expect(await queue.progress()).toEqual({ total: 45, written: 45, failed: 0, state: 'done' });
    expect(events.some((e) => e.state === 'writing')).toBe(true);
    expect(events.some((e) => e.state === 'cooling_down' && typeof e.resumeAt === 'string')).toBe(true);
    await queue.clearFinished();
    expect(await queue.progress()).toEqual({ total: 0, written: 0, failed: 0, state: 'idle' });
    queue.dispose();
  });

  it('counts blocked and quarantined facts as skipped, not as part of the total', async () => {
    const { queue } = build();
    await queue.enqueue([fact({ text: 'ok' }), fact({ text: 'card', sensitive: ['card_number'] }), fact({ text: 'sneaky', flags: ['markup'] })]);
    await queue.start();
    expect(await queue.progress()).toMatchObject({ total: 1, written: 1, state: 'done' });
  });

  it('pause survives a restart and resume finishes the job', async () => {
    const db = freshDb();
    const { queue } = build(db);
    await queue.enqueue(facts(25));
    await queue.pause();
    await queue.start();
    expect(await queue.progress()).toMatchObject({ state: 'paused', written: 0 });
    queue.dispose();

    const restarted = build(db).queue;
    expect(await restarted.isPaused()).toBe(true);
    await restarted.resume();
    expect(await restarted.progress()).toMatchObject({ state: 'done', written: 25, total: 25 });
  });

  it('aborts mid-run on pause without losing items', async () => {
    const { queue, relayer } = build();
    await queue.enqueue(facts(60));
    relayer.runningPolls = 1;
    const run = queue.start();
    await queue.pause();
    await run;
    const p = await queue.progress();
    expect(p.state).toBe('paused');
    expect(p.written).toBeLessThan(60);
    await queue.resume();
    expect(await queue.progress()).toMatchObject({ state: 'done', written: 60 });
  });

  it('finishes jobs left unconfirmed by a previous worker', async () => {
    const db = freshDb();
    const clock = new TestClock();
    const relayer = new FakeRelayer(clock);
    const memory = new FerryMemory({
      seed: SEED,
      accountId: ACCOUNT,
      serverUrl: 'https://relayer.memory.walrus.xyz',
      clock,
      client: relayer,
      db,
      engine: { pollTimeoutMs: 1_000 },
    });
    const queue = new ImportQueue(memory, db);
    await queue.enqueue(facts(3));
    relayer.runningPolls = 1_000;
    await queue.start();
    expect(await queue.progress()).toMatchObject({ state: 'idle', written: 0 });
    relayer.runningPolls = 0;
    const next = build(db, clock, relayer).queue;
    await next.start();
    expect(await next.progress()).toMatchObject({ state: 'done', written: 3 });
    expect(relayer.calls.remember + relayer.calls.bulk).toBe(1);
  });

  it('enters the error state when the key is rejected', async () => {
    const { queue, relayer } = build();
    relayer.failNext('bulk', httpError(401, 'AUTH_REJECTED'), 2);
    await queue.enqueue(facts(2));
    await queue.start();
    expect(queue.lastError).toBe('key_rejected');
    expect(await queue.progress()).toMatchObject({ state: 'error', written: 0 });
  });

  it('records other failures as an error message and can resume afterwards', async () => {
    const { queue, relayer, memory } = build();
    relayer.failNext('bulk', httpError(503, 'AUTH_UPSTREAM_UNAVAILABLE'), 5);
    await queue.enqueue(facts(2));
    await queue.start();
    expect(queue.lastError).toBe('HTTP 503');
    memory.governor.clearKeyRejected();
    await queue.resume();
    expect(await queue.progress()).toMatchObject({ state: 'done', written: 2 });
  });
});
