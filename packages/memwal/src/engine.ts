import {
  ALWAYS_BLOCKED,
  CandidateFact,
  ConflictResolution,
  FACT_TYPES,
  JudgeResponse,
  MAX_FACT_CHARS,
  MemoryRef,
  decodeMemory,
  encodeMemory,
  normalizeFactText,
  type FerryHeader,
  type Namespace,
  type StoredMemory,
  type Suggestion,
} from '@ferry/core';
import type { RecallMemory } from '@mysten-incubation/memwal';
import { ClockDriftError, CoolingDownError, KeyRejectedError, classifyError, type RateGovernor, type RunOptions } from './governor.js';
import { batchIdempotencyKey, buildHeader, chunk, mergeReceipts } from './header.js';
import { LocalIndex } from './local-index.js';
import { scoreCandidate } from './rank.js';
import type { MemoryTransport } from './transport.js';
import type {
  Clock,
  ConflictJudge,
  ConflictRecord,
  FactWriteResult,
  FerryMemoryApi,
  JobItem,
  JobRecord,
  LibraryFilter,
  MemoryRecord,
  Neighbor,
  ReconcileOutcome,
  SyncReport,
  TimelineEntry,
  WriteOptions,
} from './types.js';

export const MAX_BULK_ITEMS = 20;
const CORE: Namespace = 'ferry-core';
const SYNC_CURSOR_KEY = 'sync.cursor';
const DONE_JOB_TTL_MS = 86_400_000;

export interface EngineOptions {
  clock: Clock;
  random?: () => number;
  /** Status polls cost a point each, so poll slowly (RESEARCH 1.2 says at least 3 s). */
  pollIntervalMs?: number;
  /** After this, unfinished jobs stay persisted and are resumed later. */
  pollTimeoutMs?: number;
  /** Recall right after a write can miss while the relayer index catches up (PRD 5.4). */
  indexLagWindowMs?: number;
  /** Distance above which a recalled memory is not a conflict candidate. */
  neighborMaxDistance?: number;
}

export class UnknownMemoryError extends Error {
  override readonly name = 'UnknownMemoryError';
  constructor(readonly ref: string) {
    super(`No Ferry memory ${ref} in the local index. Sync first.`);
  }
}

export class UnsupportedInModeError extends Error {
  override readonly name = 'UnsupportedInModeError';
  constructor(operation: string, mode: string) {
    super(`${operation} is not available in ${mode} mode.`);
  }
}

interface Candidate {
  ref: string;
  factText: string;
  header: FerryHeader;
  distance: number;
  createdAt: number | null;
  inRelevance: boolean;
  inRecent: boolean;
}

/** A 4xx the relayer will repeat for this exact batch (validation, 409 key reuse, 402 quota). */
function isPermanentRejection(err: unknown): boolean {
  if (err instanceof CoolingDownError || err instanceof KeyRejectedError || err instanceof ClockDriftError) return false;
  if (!(err instanceof Error) || err.name === 'AbortError') return false;
  return classifyError(err).kind === 'fatal';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
}

/**
 * Memory logic shared by Standard and Vault mode: header building, batching, durable jobs,
 * recall and rerank, tombstones, supersede chains, sync and conflicts. Transport differences
 * (relayer jobs versus client-side SEAL writes) live behind `MemoryTransport`.
 */
export class MemoryEngine implements FerryMemoryApi {
  readonly index: LocalIndex;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly lagWindowMs: number;
  private readonly neighborMaxDistance: number;

  protected constructor(
    protected readonly transport: MemoryTransport,
    index: LocalIndex,
    readonly governor: RateGovernor,
    options: EngineOptions,
  ) {
    this.index = index;
    this.clock = options.clock;
    this.random = options.random ?? Math.random;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 120_000;
    this.lagWindowMs = options.indexLagWindowMs ?? 30_000;
    this.neighborMaxDistance = options.neighborMaxDistance ?? 0.6;
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private get db() {
    return this.index.db;
  }

  destroy(): void {
    this.transport.destroy();
    this.db.close();
  }

  /* ---------------------------------------------------------------- */
  /* Writes                                                            */
  /* ---------------------------------------------------------------- */

  async writeFacts(facts: readonly CandidateFact[], opts: WriteOptions = {}): Promise<FactWriteResult[]> {
    const namespace = opts.namespace ?? CORE;
    const parsed = facts.map((f) => CandidateFact.parse(f));
    const results = new Map<string, FactWriteResult>();
    const items: JobItem[] = [];
    for (const fact of parsed) {
      const blocked = fact.sensitive.filter((c) => ALWAYS_BLOCKED.includes(c));
      if (blocked.length > 0) {
        results.set(fact.id, { factId: fact.id, status: 'blocked', categories: blocked });
        continue;
      }
      const sup = opts.supersedes?.[fact.id] ?? null;
      const header = buildHeader(fact, sup === null ? null : MemoryRef.parse(sup));
      let encoded;
      try {
        encoded = encodeMemory(fact.text, header);
      } catch (err) {
        results.set(fact.id, { factId: fact.id, status: 'failed', error: errorText(err) });
        continue;
      }
      if (fact.flags.length > 0) {
        // Quarantine never leaves the device: the user reviews it, Walrus never sees it.
        const ref = `q:${fact.id}`;
        await this.index.putRecord(this.recordFor(ref, namespace, 'fact', encoded.factText, header, 'quarantine'), fact.receipts);
        results.set(fact.id, { factId: fact.id, status: 'quarantined', ref });
        continue;
      }
      items.push({ factId: fact.id, memoryText: encoded.memoryText, factText: encoded.factText, header, receipts: fact.receipts, kind: 'fact' });
    }
    for (const batch of chunk(items, MAX_BULK_ITEMS)) {
      for (const r of await this.writeBatch(namespace, batch, opts.signal)) results.set(r.factId, r);
    }
    return parsed.map((f) => results.get(f.id) ?? { factId: f.id, status: 'failed', error: 'not processed' });
  }

  private recordFor(
    ref: string,
    namespace: Namespace,
    kind: MemoryRecord['kind'],
    factText: string,
    header: FerryHeader | null,
    status: MemoryRecord['status'],
    writtenAt: string = this.nowIso(),
  ): MemoryRecord {
    return {
      ref,
      namespace,
      kind,
      factText,
      header,
      status,
      type: header?.type ?? null,
      sources: header?.sources ?? [],
      heardAt: header?.at ?? null,
      writtenAt,
      supersededBy: null,
      memoryId: null,
      endEpoch: null,
      expiresAt: null,
    };
  }

  /** Persists the job before sending, so a worker killed mid-request resumes with the same key. */
  private async writeBatch(namespace: Namespace, items: JobItem[], signal?: AbortSignal): Promise<FactWriteResult[]> {
    const key = await batchIdempotencyKey(namespace, items.map((i) => i.memoryText));
    let job = await this.db.jobs.get(key);
    if (!job) {
      job = { idempotencyKey: key, namespace, items, jobIds: null, state: 'pending', createdAt: this.nowIso(), outcomes: items.map(() => null) };
      await this.db.jobs.put(job);
      await this.index.rebuildChains();
    }
    return this.driveJob(job, signal);
  }

  private async driveJob(job: JobRecord, signal?: AbortSignal): Promise<FactWriteResult[]> {
    const run: RunOptions = signal ? { signal } : {};
    if (job.state === 'pending') {
      let submitted;
      try {
        submitted = await this.transport.submit(job.namespace, job.items.map((i) => i.memoryText), job.idempotencyKey, run);
      } catch (err) {
        // Anything but a permanent rejection of this batch stays persisted for resume.
        if (!isPermanentRejection(err)) throw err;
        await this.db.jobs.delete(job.idempotencyKey);
        await this.index.rebuildChains();
        return job.items.map((i) => ({ factId: i.factId, status: 'failed', error: errorText(err) }));
      }
      if (submitted.kind === 'stored') {
        job.jobIds = submitted.blobIds.map(() => '');
        job.outcomes = submitted.blobIds.map((blobId) => ({ blobId }));
        job.state = 'done';
      } else {
        job.jobIds = submitted.jobIds;
        job.state = 'submitted';
      }
      await this.db.jobs.put(job);
    }
    if (job.state === 'submitted') await this.pollJob(job, run);
    await this.applyOutcomes(job);
    return this.resultsFor(job);
  }

  private async pollJob(job: JobRecord, run: RunOptions): Promise<void> {
    const deadline = this.clock.now() + this.pollTimeoutMs;
    const jobIds = job.jobIds ?? [];
    for (;;) {
      const pending = jobIds.filter((_, i) => job.outcomes[i] === null);
      if (pending.length === 0) {
        job.state = 'done';
        break;
      }
      if (this.clock.now() >= deadline) break;
      await this.clock.sleep(this.pollIntervalMs, run.signal);
      const statuses = await this.transport.status(pending, run);
      for (const s of statuses) {
        const i = jobIds.indexOf(s.job_id);
        if (i < 0) continue;
        if (s.status === 'done' && s.blob_id) job.outcomes[i] = { blobId: s.blob_id };
        else if (s.status === 'failed' || s.status === 'not_found') job.outcomes[i] = { error: s.status === 'not_found' ? 'job not found' : (s.error ?? 'failed').slice(0, 200) };
      }
      await this.db.jobs.put(job);
    }
    await this.db.jobs.put(job);
  }

  private async applyOutcomes(job: JobRecord): Promise<void> {
    const writtenAt = this.nowIso();
    for (const [i, item] of job.items.entries()) {
      const outcome = job.outcomes[i];
      if (!outcome || !('blobId' in outcome)) continue;
      if (await this.index.get(outcome.blobId)) continue;
      const status = item.kind === 'tombstone' ? 'hidden' : 'active';
      await this.index.putRecord(this.recordFor(outcome.blobId, job.namespace, item.kind, item.factText, item.header, status, writtenAt), item.receipts);
    }
    await this.index.rebuildChains();
  }

  private resultsFor(job: JobRecord): FactWriteResult[] {
    return job.items.map((item, i): FactWriteResult => {
      const o = job.outcomes[i];
      if (!o) return { factId: item.factId, status: 'pending', jobKey: job.idempotencyKey };
      if ('blobId' in o) return { factId: item.factId, status: 'written', ref: o.blobId };
      return { factId: item.factId, status: 'failed', error: o.error };
    });
  }

  /** Call on worker start: finishes every batch a previous worker submitted but never confirmed. */
  async resumePendingJobs(signal?: AbortSignal): Promise<FactWriteResult[]> {
    const cutoff = new Date(this.clock.now() - DONE_JOB_TTL_MS).toISOString();
    const stale = await this.db.jobs.where('state').equals('done').filter((j) => j.createdAt < cutoff).primaryKeys();
    await this.db.jobs.bulkDelete(stale);
    const open = await this.db.jobs.where('state').anyOf('pending', 'submitted').toArray();
    const out: FactWriteResult[] = [];
    for (const job of open) out.push(...(await this.driveJob(job, signal)));
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Hide and supersede                                                */
  /* ---------------------------------------------------------------- */

  private async requireFact(ref: string): Promise<MemoryRecord & { header: FerryHeader }> {
    const rec = await this.index.get(ref);
    if (!rec || rec.kind !== 'fact' || rec.header === null) throw new UnknownMemoryError(ref);
    return { ...rec, header: rec.header };
  }

  /** Writes a tombstone (`st=hidden sup=<ref>`); Walrus blobs cannot be deleted, only hidden. */
  async hide(ref: string, signal?: AbortSignal): Promise<void> {
    const rec = await this.requireFact(ref);
    if (rec.status === 'quarantine') {
      await this.index.setStatus(ref, 'hidden');
      return;
    }
    if (rec.status === 'hidden') return;
    const header: FerryHeader = { ...rec.header, at: this.nowIso().slice(0, 10), supersedes: ref, status: 'hidden' };
    const encoded = encodeMemory(`Ferry tombstone for ${ref}`, header);
    await this.index.setStatus(ref, 'hidden');
    const results = await this.writeBatch(
      rec.namespace,
      [{ factId: `tombstone:${ref}`, memoryText: encoded.memoryText, factText: encoded.factText, header, receipts: [], kind: 'tombstone' }],
      signal,
    );
    const [result] = results;
    if (result?.status === 'failed') {
      await this.index.rebuildChains();
      throw new Error(`hide: tombstone write failed: ${result.error}`);
    }
  }

  async supersede(oldRef: string, newFact: CandidateFact): Promise<FactWriteResult> {
    const old = await this.requireFact(oldRef);
    const [result] = await this.writeFacts([newFact], { namespace: old.namespace, supersedes: { [newFact.id]: oldRef } });
    return result ?? { factId: newFact.id, status: 'failed', error: 'not processed' };
  }

  /* ---------------------------------------------------------------- */
  /* Recall                                                            */
  /* ---------------------------------------------------------------- */

  private decodeHits(hits: readonly RecallMemory[], into: Map<string, Candidate>, source: 'relevance' | 'recent'): void {
    for (const hit of hits) {
      const decoded = decodeMemory(hit.text);
      if (!decoded.ok) continue;
      const createdAt = hit.created_at ? Date.parse(hit.created_at) : NaN;
      const prior = into.get(hit.blob_id);
      const c: Candidate = prior ?? {
        ref: hit.blob_id,
        factText: decoded.factText,
        header: decoded.header,
        distance: hit.distance,
        createdAt: Number.isNaN(createdAt) ? null : createdAt,
        inRelevance: false,
        inRecent: false,
      };
      c.distance = Math.min(c.distance, hit.distance);
      if (source === 'relevance') c.inRelevance = true;
      else c.inRecent = true;
      into.set(hit.blob_id, c);
    }
  }

  private async recallMerged(query: string, limit: number, run: RunOptions): Promise<Map<string, Candidate>> {
    const calls: Array<Promise<RecallMemory[]>> = [this.transport.recall({ query, limit, namespace: CORE, sort: 'relevance' }, run)];
    if (this.transport.supportsRecent) calls.push(this.transport.recall({ query, limit: 20, namespace: CORE, sort: 'recent' }, run));
    const settled = await Promise.allSettled(calls);
    const merged = new Map<string, Candidate>();
    const [rel, rec] = settled;
    if (rel?.status === 'fulfilled') this.decodeHits(rel.value, merged, 'relevance');
    if (rec?.status === 'fulfilled') this.decodeHits(rec.value, merged, 'recent');
    if (settled.every((s) => s.status === 'rejected')) throw (rel as PromiseRejectedResult).reason;
    return merged;
  }

  /**
   * Composer suggestions: relevance and recent recalls merged and reranked here, minus anything
   * the local index or the results themselves say is hidden, superseded, contested or local only.
   * Never waits for budget; throws `CoolingDownError` so the chip can say so.
   */
  async recallForDraft(draft: string, k: number): Promise<Suggestion[]> {
    const query = normalizeFactText(draft, 2000).text;
    if (query.length === 0) return [];
    const want = Math.min(20, Math.max(1, Math.floor(k)));
    const limit = Math.min(100, Math.max(want * 3, 20));
    const run: RunOptions = { wait: false, maxAttempts: 2 };
    let merged = await this.recallMerged(query, limit, run);
    if (merged.size === 0 && (await this.index.hasWritesSince(new Date(this.clock.now() - this.lagWindowMs).toISOString()))) {
      await this.clock.sleep(400 + Math.round(800 * this.random()));
      merged = await this.recallMerged(query, limit, run);
    }
    const hiddenOrReplaced = new Set<string>();
    for (const c of merged.values()) if (c.header.supersedes) hiddenOrReplaced.add(c.header.supersedes);
    const now = this.clock.now();
    const scored: Suggestion[] = [];
    for (const c of merged.values()) {
      if (c.header.status === 'hidden' || hiddenOrReplaced.has(c.ref)) continue;
      const local = await this.index.get(c.ref);
      if (local && local.status !== 'active') continue;
      const at = c.createdAt ?? Date.parse(c.header.at);
      scored.push({
        ref: c.ref,
        text: c.factText,
        type: c.header.type,
        sources: c.header.sources,
        heardAt: c.header.at,
        score: scoreCandidate({ distance: c.distance, at, confidence: c.header.confidence, type: c.header.type, inBoth: c.inRelevance && c.inRecent }, now),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, want);
  }

  /* ---------------------------------------------------------------- */
  /* Sync                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Rebuilds the index from Walrus Memory. `listMemories` is metadata only (no text), so rows
   * unknown locally are hydrated through recall, which returns text by blob id.
   */
  async syncFromWalrus(opts: { full?: boolean; signal?: AbortSignal } = {}): Promise<SyncReport> {
    const run: RunOptions = opts.signal ? { signal: opts.signal } : {};
    const stored = opts.full ? undefined : ((await this.db.kv.get(SYNC_CURSOR_KEY))?.value as string | undefined);
    let cursor = stored;
    let fullWalk = cursor === undefined;
    let resynced = false;
    const seen = new Set<string>();
    const report: SyncReport = { listed: 0, added: 0, updated: 0, removed: 0, unhydrated: 0, resynced: false };
    for (;;) {
      const pending = this.transport.list(cursor === undefined ? { limit: 500 } : { cursor, limit: 500 }, run);
      if (pending === null) throw new UnsupportedInModeError('syncFromWalrus', this.transport.mode);
      const page = await pending;
      if (page.must_resync) {
        if (resynced) throw new Error('syncFromWalrus: relayer asked to resync twice in one walk');
        resynced = true;
        fullWalk = true;
        cursor = undefined;
        seen.clear();
        continue;
      }
      for (const m of page.memories) {
        if (m.namespace_id !== CORE) continue;
        report.listed += 1;
        seen.add(m.blob_id);
        const existing = await this.index.get(m.blob_id);
        const meta = { memoryId: m.memory_id, endEpoch: m.end_epoch, expiresAt: m.expires_at };
        if (existing) {
          await this.db.memories.update(m.blob_id, meta);
          report.updated += 1;
        } else {
          const writtenAt = Number.isNaN(Date.parse(m.created_at)) ? this.nowIso() : new Date(m.created_at).toISOString();
          await this.index.putRecord({ ...this.recordFor(m.blob_id, CORE, 'unhydrated', '', null, 'active', writtenAt), ...meta });
          report.added += 1;
        }
      }
      for (const d of page.deleted) {
        if (d.namespace_id !== CORE) continue;
        const gone = await this.db.memories.where('memoryId').equals(d.memory_id).primaryKeys();
        await this.db.memories.bulkDelete(gone);
        report.removed += gone.length;
      }
      cursor = page.next_cursor ?? cursor;
      if (!page.has_more) break;
    }
    if (cursor !== undefined) await this.db.kv.put({ key: SYNC_CURSOR_KEY, value: cursor });
    if (fullWalk) {
      // Only rows the relayer listed before can be judged missing; fresh writes may not be listed yet.
      const missing = await this.db.memories
        .filter((r) => r.namespace === CORE && r.memoryId !== null && !seen.has(r.ref))
        .primaryKeys();
      await this.db.memories.bulkDelete(missing);
      report.removed += missing.length;
    }
    report.unhydrated = await this.hydrate(run);
    report.resynced = resynced;
    await this.index.rebuildChains();
    return report;
  }

  /**
   * Counts memories stored in a namespace from `listMemories` metadata alone: no text is read and
   * no recall budget is spent, so a public counter can never leak a fact. Tombstones are memories
   * too, so this is a count of stored records, not of active facts.
   */
  async countListed(namespace: Namespace = CORE, opts: { signal?: AbortSignal } = {}): Promise<number> {
    const run: RunOptions = opts.signal ? { signal: opts.signal } : {};
    const live = new Set<string>();
    let cursor: string | undefined;
    let resynced = false;
    for (;;) {
      const pending = this.transport.list(cursor === undefined ? { limit: 500 } : { cursor, limit: 500 }, run);
      if (pending === null) throw new UnsupportedInModeError('countListed', this.transport.mode);
      const page = await pending;
      if (page.must_resync) {
        if (resynced) throw new Error('countListed: relayer asked to resync twice in one walk');
        resynced = true;
        cursor = undefined;
        live.clear();
        continue;
      }
      for (const m of page.memories) if (m.namespace_id === namespace) live.add(m.memory_id);
      for (const d of page.deleted) if (d.namespace_id === namespace) live.delete(d.memory_id);
      cursor = page.next_cursor ?? cursor;
      if (!page.has_more) break;
    }
    return live.size;
  }

  private async hydrate(run: RunOptions): Promise<number> {
    const missing = new Set(await this.db.memories.where('kind').equals('unhydrated').primaryKeys());
    // Every Ferry memory ends in a header naming its type, so these queries reach all of them.
    const queries = ['ferry', ...FACT_TYPES];
    for (const query of queries) {
      if (missing.size === 0) break;
      const hits = await this.transport.recall({ query, limit: 100, namespace: CORE, sort: 'relevance' }, run);
      for (const hit of hits) {
        if (!missing.has(hit.blob_id)) continue;
        missing.delete(hit.blob_id);
        const decoded = decodeMemory(hit.text);
        const patch: Partial<MemoryRecord> = decoded.ok
          ? {
              kind: decoded.header.status === 'hidden' ? 'tombstone' : 'fact',
              factText: decoded.factText,
              header: decoded.header,
              type: decoded.header.type,
              sources: decoded.header.sources,
              heardAt: decoded.header.at,
              status: decoded.header.status === 'hidden' ? 'hidden' : 'active',
            }
          : { kind: 'foreign', factText: decoded.factText.slice(0, MAX_FACT_CHARS) };
        await this.db.memories.update(hit.blob_id, patch);
      }
    }
    return missing.size;
  }

  /* ---------------------------------------------------------------- */
  /* Library and export                                                */
  /* ---------------------------------------------------------------- */

  list(filter: LibraryFilter = {}): Promise<StoredMemory[]> {
    return this.index.list(filter);
  }

  recent(limit?: number): Promise<StoredMemory[]> {
    return this.index.recent(limit);
  }

  timeline(ref: string): Promise<TimelineEntry[]> {
    return this.index.timeline(ref);
  }

  exportAll(): Promise<StoredMemory[]> {
    return this.index.allFacts();
  }

  /* ---------------------------------------------------------------- */
  /* Conflicts (PRD F5)                                                */
  /* ---------------------------------------------------------------- */

  /** Close facts of the same type that are still in force. */
  async findNeighbors(fact: Pick<CandidateFact, 'text' | 'type'>): Promise<Neighbor[]> {
    const query = normalizeFactText(fact.text).text;
    if (query.length === 0) return [];
    const hits = await this.transport.recall({ query, limit: 10, namespace: CORE, sort: 'relevance' }, {});
    const out: Neighbor[] = [];
    for (const hit of hits) {
      if (hit.distance > this.neighborMaxDistance) continue;
      const decoded = decodeMemory(hit.text);
      if (!decoded.ok || decoded.header.status !== 'active' || decoded.header.type !== fact.type) continue;
      const local = await this.index.get(hit.blob_id);
      if (local && local.status !== 'active' && local.status !== 'conflict') continue;
      out.push({ ref: hit.blob_id, text: decoded.factText, distance: hit.distance, header: decoded.header });
    }
    return out;
  }

  /**
   * Runs a new fact through the judge. `contradicts` holds the fact as an open conflict for the
   * user, `same` merges its receipts into the existing memory locally (no write), `refines` holds
   * it as a supersede candidate, anything else writes it.
   */
  async reconcile(fact: CandidateFact, judge: ConflictJudge): Promise<ReconcileOutcome> {
    const parsed = CandidateFact.parse(fact);
    const neighbors = (await this.findNeighbors(parsed)).slice(0, 10);
    if (neighbors.length > 0) {
      const response = JudgeResponse.parse(
        await judge({ fact: { text: parsed.text, type: parsed.type }, neighbors: neighbors.map((n) => ({ ref: n.ref, text: n.text })) }),
      );
      const known = new Set(neighbors.map((n) => n.ref));
      const verdicts = response.verdicts.filter((v) => known.has(v.ref));
      const contradiction = verdicts.find((v) => v.verdict === 'contradicts');
      const same = verdicts.find((v) => v.verdict === 'same');
      const refines = verdicts.find((v) => v.verdict === 'refines');
      if (contradiction) return this.openConflict(parsed, contradiction.ref, 'contradicts', contradiction.reason);
      if (same) {
        await this.mergeInto(same.ref, parsed);
        return { kind: 'merged', ref: same.ref };
      }
      if (refines) return this.openConflict(parsed, refines.ref, 'refines', refines.reason);
    }
    const [result] = await this.writeFacts([parsed]);
    return { kind: 'written', result: result ?? { factId: parsed.id, status: 'failed', error: 'not processed' } };
  }

  private async mergeInto(ref: string, fact: CandidateFact): Promise<void> {
    const rec = await this.index.get(ref);
    if (!rec) {
      // Known to the relayer but not yet synced here: keep the receipts once the row exists.
      await this.index.putRecord(this.recordFor(ref, CORE, 'unhydrated', '', null, 'active'));
    }
    await this.index.addReceipts(ref, fact.receipts);
    const merged = await this.index.receiptsFor(ref);
    const sources = [...new Set([...(rec?.sources ?? []), ...merged.map((r) => r.vendor)])];
    await this.db.memories.update(ref, { sources });
  }

  private async openConflict(fact: CandidateFact, existingRef: string, verdict: 'contradicts' | 'refines', reason: string): Promise<ReconcileOutcome> {
    const record: ConflictRecord = {
      id: globalThis.crypto.randomUUID(),
      verdict,
      existingRef,
      newFact: fact,
      reason: reason.slice(0, 200),
      state: 'open',
      createdAt: this.nowIso(),
      resolution: null,
      resultRefs: [],
    };
    await this.db.conflicts.put(record);
    await this.index.rebuildChains();
    return { kind: 'conflict', conflictId: record.id, verdict };
  }

  openConflicts(): Promise<ConflictRecord[]> {
    return this.db.conflicts.where('state').equals('open').toArray();
  }

  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<FactWriteResult[]> {
    const res = ConflictResolution.parse(resolution);
    const conflict = await this.db.conflicts.get(conflictId);
    if (!conflict || conflict.state !== 'open') throw new Error(`resolveConflict: no open conflict ${conflictId}`);
    if ((res.kind === 'keep_new' || res.kind === 'merge') && res.supersede !== conflict.existingRef) {
      throw new Error('resolveConflict: supersede must name the conflicting memory');
    }
    const fact = conflict.newFact;
    let results: FactWriteResult[] = [];
    switch (res.kind) {
      case 'keep_new':
        results = await this.writeFacts([fact], { supersedes: { [fact.id]: conflict.existingRef } });
        break;
      case 'keep_old':
        break;
      case 'merge': {
        const existingReceipts = await this.index.receiptsFor(conflict.existingRef);
        const merged: CandidateFact = { ...fact, text: res.text, receipts: mergeReceipts(fact.receipts, existingReceipts) };
        results = await this.writeFacts([merged], { supersedes: { [fact.id]: conflict.existingRef } });
        break;
      }
      case 'keep_both': {
        const context = normalizeFactText(res.context, 120).text;
        const text = context.length > 0 ? `${fact.text} (${context})` : fact.text;
        results = await this.writeFacts([{ ...fact, text: normalizeFactText(text).text }]);
        break;
      }
    }
    const refs = results.flatMap((r) => (r.status === 'written' ? [r.ref] : []));
    const failed = results.find((r) => r.status === 'failed' || r.status === 'blocked');
    if (failed) throw new Error(`resolveConflict: write ${failed.status}`);
    await this.db.conflicts.update(conflictId, { state: 'resolved', resolution: res, resultRefs: refs });
    await this.index.rebuildChains();
    return results;
  }
}
