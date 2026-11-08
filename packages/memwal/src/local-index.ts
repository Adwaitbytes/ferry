import type { MemoryStatus, Receipt, StoredMemory } from '@ferry/core';
import type { FerryDb } from './db.js';
import { mergeReceipts } from './header.js';
import type { LibraryFilter, MemoryRecord, TimelineEntry } from './types.js';

const DEFAULT_PAGE = 50;

/**
 * Dexie backed mirror of what Ferry wrote to Walrus Memory. Statuses that come from Walrus
 * (hidden by a tombstone, superseded by a newer fact) are derived in `rebuildChains`, so a sync
 * from another device and a local write converge on the same answer.
 */
export class LocalIndex {
  constructor(readonly db: FerryDb) {}

  get(ref: string): Promise<MemoryRecord | undefined> {
    return this.db.memories.get(ref);
  }

  async putRecord(record: MemoryRecord, receipts: readonly Receipt[] = []): Promise<void> {
    await this.db.transaction('rw', this.db.memories, this.db.receipts, async () => {
      await this.db.memories.put(record);
      if (receipts.length > 0) await this.addReceipts(record.ref, receipts);
    });
  }

  async addReceipts(ref: string, receipts: readonly Receipt[]): Promise<void> {
    const existing = await this.receiptsFor(ref);
    const merged = mergeReceipts(existing, receipts);
    await this.db.receipts.bulkPut(merged.map((receipt) => ({ ref, quoteHash: receipt.quoteHash, receipt })));
  }

  async receiptsFor(ref: string): Promise<Receipt[]> {
    const rows = await this.db.receipts.where('ref').equals(ref).toArray();
    return rows.map((r) => r.receipt);
  }

  async setStatus(ref: string, status: MemoryStatus): Promise<void> {
    await this.db.memories.update(ref, { status });
  }

  toStored(record: MemoryRecord, receipts: Receipt[]): StoredMemory | null {
    if (record.header === null || (record.kind !== 'fact' && record.kind !== 'tombstone')) return null;
    return {
      ref: record.ref,
      namespace: record.namespace,
      text: record.factText,
      header: record.header,
      status: record.status,
      receipts,
      writtenAt: record.writtenAt,
      supersededBy: record.supersededBy,
    };
  }

  private async hydrateStored(records: readonly MemoryRecord[]): Promise<StoredMemory[]> {
    const refs = records.map((r) => r.ref);
    const rows = refs.length === 0 ? [] : await this.db.receipts.where('ref').anyOf(refs).toArray();
    const byRef = new Map<string, Receipt[]>();
    for (const row of rows) {
      const list = byRef.get(row.ref) ?? [];
      list.push(row.receipt);
      byRef.set(row.ref, list);
    }
    const out: StoredMemory[] = [];
    for (const r of records) {
      const stored = this.toStored(r, byRef.get(r.ref) ?? []);
      if (stored) out.push(stored);
    }
    return out;
  }

  /** Library query. Facts only: tombstones, unverified and unhydrated rows are not memories. */
  async list(filter: LibraryFilter = {}): Promise<StoredMemory[]> {
    const t = this.db.memories;
    const base = filter.status
      ? t.where('status').equals(filter.status)
      : filter.type
        ? t.where('type').equals(filter.type)
        : filter.vendor
          ? t.where('sources').equals(filter.vendor)
          : t.toCollection();
    const matches = await base
      .filter(
        (r) =>
          r.kind === 'fact' &&
          (!filter.status || r.status === filter.status) &&
          (!filter.type || r.type === filter.type) &&
          (!filter.vendor || r.sources.includes(filter.vendor)) &&
          (!filter.from || (r.heardAt !== null && r.heardAt >= filter.from)) &&
          (!filter.to || (r.heardAt !== null && r.heardAt <= filter.to)),
      )
      .toArray();
    matches.sort((a, b) => (a.writtenAt < b.writtenAt ? 1 : a.writtenAt > b.writtenAt ? -1 : 0));
    const offset = filter.offset ?? 0;
    return this.hydrateStored(matches.slice(offset, offset + (filter.limit ?? DEFAULT_PAGE)));
  }

  /**
   * Newest active facts. Exists because recall `sort: "recent"` only reorders about 50 semantic
   * candidates (PRD 5.4), so it cannot answer "what did I add last week".
   */
  async recent(limit = DEFAULT_PAGE): Promise<StoredMemory[]> {
    const rows: MemoryRecord[] = [];
    await this.db.memories
      .orderBy('writtenAt')
      .reverse()
      .until(() => rows.length >= limit)
      .each((r) => {
        if (r.kind === 'fact' && r.status === 'active') rows.push(r);
      });
    return this.hydrateStored(rows);
  }

  async allFacts(): Promise<StoredMemory[]> {
    const rows = await this.db.memories.where('kind').equals('fact').toArray();
    return this.hydrateStored(rows);
  }

  async hasWritesSince(sinceIso: string): Promise<boolean> {
    return (await this.db.memories.where('writtenAt').aboveOrEqual(sinceIso).count()) > 0;
  }

  /**
   * Recomputes every derived status from the tombstones and supersede links in the index, plus
   * tombstones still in flight (so a hide sticks before the relayer confirms it) and open
   * contradictions. Quarantine is local and never derived.
   */
  async rebuildChains(): Promise<void> {
    await this.db.transaction('rw', this.db.memories, this.db.jobs, this.db.conflicts, async () => {
      const all = await this.db.memories.toArray();
      const hidden = new Set<string>();
      const supersededBy = new Map<string, MemoryRecord>();
      for (const r of all) {
        const sup = r.header?.supersedes ?? null;
        if (sup === null) continue;
        if (r.kind === 'tombstone') hidden.add(sup);
        else if (r.kind === 'fact' && r.status !== 'quarantine') {
          const prior = supersededBy.get(sup);
          if (!prior || prior.writtenAt < r.writtenAt) supersededBy.set(sup, r);
        }
      }
      const inFlight = await this.db.jobs.where('state').anyOf('pending', 'submitted').toArray();
      for (const job of inFlight) {
        for (const item of job.items) if (item.kind === 'tombstone' && item.header.supersedes) hidden.add(item.header.supersedes);
      }
      const contested = new Set(
        (await this.db.conflicts.where('state').equals('open').toArray()).filter((c) => c.verdict === 'contradicts').map((c) => c.existingRef),
      );
      for (const r of all) {
        if (r.kind !== 'fact' || r.status === 'quarantine') continue;
        const by = supersededBy.get(r.ref)?.ref ?? null;
        const status: MemoryStatus = hidden.has(r.ref) ? 'hidden' : by ? 'superseded' : contested.has(r.ref) ? 'conflict' : 'active';
        if (status !== r.status || by !== r.supersededBy) await this.db.memories.update(r.ref, { status, supersededBy: by });
      }
    });
  }

  /** Every version of a fact, oldest first, following supersede links both ways. */
  async timeline(ref: string): Promise<TimelineEntry[]> {
    const start = await this.get(ref);
    if (!start) return [];
    const chain: MemoryRecord[] = [start];
    const seen = new Set([start.ref]);
    let cursor: MemoryRecord | undefined = start;
    while (cursor?.header?.supersedes) {
      const prev: MemoryRecord | undefined = await this.get(cursor.header.supersedes);
      if (!prev || seen.has(prev.ref)) break;
      seen.add(prev.ref);
      chain.unshift(prev);
      cursor = prev;
    }
    cursor = start;
    while (cursor?.supersededBy) {
      const next: MemoryRecord | undefined = await this.get(cursor.supersededBy);
      if (!next || seen.has(next.ref)) break;
      seen.add(next.ref);
      chain.push(next);
      cursor = next;
    }
    const stored = await this.hydrateStored(chain);
    return stored.map((memory) => ({ memory, isRequested: memory.ref === ref }));
  }
}
