import { CandidateFact, type ImportProgress } from '@ferry/core';
import type { FerryDb } from './db.js';
import type { MemoryEngine } from './engine.js';
import { KeyRejectedError, type GovernorState } from './governor.js';
import type { FactWriteResult, QueueItemState } from './types.js';

const PAUSED_KEY = 'import.paused';
/** Rounds of resuming unconfirmed jobs after the queue drains, before reporting what is left. */
const MAX_SETTLE_ROUNDS = 3;

function stateFor(result: FactWriteResult): { state: QueueItemState; ref: string | null; error: string | null } {
  switch (result.status) {
    case 'written':
      return { state: 'written', ref: result.ref, error: null };
    case 'pending':
      return { state: 'pending', ref: null, error: null };
    case 'failed':
      return { state: 'failed', ref: null, error: result.error };
    case 'quarantined':
      return { state: 'skipped', ref: result.ref, error: null };
    case 'blocked':
      return { state: 'skipped', ref: null, error: `blocked: ${result.categories.join(',')}` };
  }
}

/**
 * Durable, paced import (PRD F2). Facts wait in IndexedDB, batches go through the engine (which
 * persists each relayer job before sending it), and pause survives a browser restart. Pacing
 * itself is the governor's job; this queue only decides what to send next.
 */
export class ImportQueue {
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private failure: string | null = null;
  private readonly listeners = new Set<(p: ImportProgress) => void>();
  private readonly unsubscribeGovernor: () => void;

  constructor(
    private readonly memory: MemoryEngine,
    private readonly db: FerryDb,
  ) {
    // Pass the state through: by the time progress() reads it the wait may already be over.
    this.unsubscribeGovernor = memory.governor.subscribe((state) => void this.emit(state));
  }

  dispose(): void {
    this.unsubscribeGovernor();
    this.abort?.abort();
    this.listeners.clear();
  }

  subscribe(listener: (p: ImportProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async emit(governorState?: GovernorState): Promise<void> {
    if (this.listeners.size === 0) return;
    const p = await this.progress(governorState);
    for (const l of this.listeners) l(p);
  }

  /** Adds facts; ones already queued (same fact id) are ignored. Returns how many were added. */
  async enqueue(facts: readonly CandidateFact[]): Promise<number> {
    const parsed = facts.map((f) => CandidateFact.parse(f));
    const added = await this.db.transaction('rw', this.db.queue, async () => {
      const rows = await this.db.queue.where('factId').anyOf(parsed.map((f) => f.id)).toArray();
      const seen = new Set(rows.map((r) => r.factId));
      const fresh = parsed.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });
      await this.db.queue.bulkAdd(fresh.map((fact) => ({ factId: fact.id, fact, state: 'queued' as const, ref: null, error: null })));
      return fresh.length;
    });
    await this.emit();
    return added;
  }

  async isPaused(): Promise<boolean> {
    return (await this.db.kv.get(PAUSED_KEY))?.value === true;
  }

  async pause(): Promise<void> {
    await this.db.kv.put({ key: PAUSED_KEY, value: true });
    this.abort?.abort();
    await this.running;
    await this.emit();
  }

  async resume(): Promise<void> {
    await this.db.kv.delete(PAUSED_KEY);
    this.failure = null;
    await this.start();
  }

  /** Drops finished rows so the next import's counters start from zero. */
  async clearFinished(): Promise<void> {
    await this.db.queue.where('state').anyOf('written', 'failed', 'skipped').delete();
    await this.emit();
  }

  async progress(governorState: GovernorState = this.memory.governor.state): Promise<ImportProgress> {
    const rows = await this.db.queue.toArray();
    const count = (s: QueueItemState): number => rows.filter((r) => r.state === s).length;
    const total = rows.length - count('skipped');
    const written = count('written');
    const failed = count('failed');
    const outstanding = count('queued') + count('pending');
    const gov = governorState;
    let state: ImportProgress['state'];
    let resumeAt: string | undefined;
    if (this.failure !== null) state = 'error';
    else if (await this.isPaused()) state = 'paused';
    else if (this.running) {
      if (gov.kind === 'cooling_down') {
        state = 'cooling_down';
        resumeAt = new Date(gov.resumeAt).toISOString();
      } else state = 'writing';
    } else if (outstanding === 0 && total > 0) state = 'done';
    else state = 'idle';
    return resumeAt === undefined ? { total, written, failed, state } : { total, written, failed, state, resumeAt };
  }

  get lastError(): string | null {
    return this.failure;
  }

  private async apply(results: readonly FactWriteResult[]): Promise<void> {
    for (const r of results) await this.db.queue.where('factId').equals(r.factId).modify(stateFor(r));
  }

  /** Runs until the queue is drained, paused or the key is rejected. Safe to call repeatedly. */
  start(): Promise<void> {
    this.running ??= this.loop().finally(() => {
      this.running = null;
      this.abort = null;
      void this.emit();
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    if (await this.isPaused()) return;
    this.abort = new AbortController();
    const { signal } = this.abort;
    try {
      await this.apply(await this.memory.resumePendingJobs(signal));
      for (;;) {
        if (signal.aborted) return;
        const batch = await this.db.queue.where('state').equals('queued').limit(20).toArray();
        if (batch.length === 0) break;
        await this.emit();
        await this.apply(await this.memory.writeFacts(batch.map((r) => r.fact), { signal }));
        await this.emit();
      }
      for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
        if ((await this.db.queue.where('state').equals('pending').count()) === 0) break;
        await this.apply(await this.memory.resumePendingJobs(signal));
      }
    } catch (err) {
      if (signal.aborted) return;
      this.failure = err instanceof KeyRejectedError ? 'key_rejected' : err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
    }
  }
}
