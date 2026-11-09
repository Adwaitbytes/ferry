import type {
  CandidateFact,
  ConflictResolution,
  GovernorStatus,
  ImportProgress,
  LibraryItem,
  LibraryPage,
  MemoryStatus,
  SaveResult,
  StoredMemory,
  Suggestion,
} from '@ferry/core';
import type { ImportQueuePort, MemoryPort } from './ports';

export const PAGE_SIZE = 50;

export interface ListFilter {
  status?: MemoryStatus;
  query?: string;
  cursor?: string;
}

/** One engine as the split engine sees it: a MemoryPort that can say what it holds. */
export interface PartPort extends MemoryPort {
  owns(ref: string): Promise<boolean>;
  ownsConflict(conflictId: string): Promise<boolean>;
  /** Up to `limit` items from the start, newest first; search results in rank order. */
  items(filter: Omit<ListFilter, 'cursor'>, limit: number): Promise<LibraryItem[]>;
}

export function offsetOf(cursor: string | undefined): number {
  return cursor !== undefined && /^\d{1,6}$/.test(cursor) ? Number(cursor) : 0;
}

/** Library order: newest write first, ties broken by ref so pages are stable. */
function newestFirst(a: LibraryItem, b: LibraryItem): number {
  if (a.memory.writtenAt !== b.memory.writtenAt)
    return a.memory.writtenAt < b.memory.writtenAt ? 1 : -1;
  return a.memory.ref < b.memory.ref ? -1 : a.memory.ref > b.memory.ref ? 1 : 0;
}

/** Alternates two ranked lists so neither mode's best hits are pushed off the first page. */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x !== undefined) out.push(x);
    if (y !== undefined) out.push(y);
  }
  return out;
}

/**
 * Vault mode (F10). New writes go to the Vault engine; everything already stored in Standard mode
 * stays readable, so recall, the Library and export span both. Hide and conflict resolution go to
 * whichever engine holds the memory, because a tombstone must land next to the fact it hides.
 */
export class SplitPort implements MemoryPort {
  constructor(
    private readonly standard: PartPort,
    private readonly vault: PartPort,
  ) {}

  /**
   * Suggestions are best effort: if one engine cannot answer (for example the embedding provider
   * is down), the other's facts are still worth offering. Only a failure of both is an error.
   */
  async recallForDraft(draft: string, k: number): Promise<Suggestion[]> {
    const [a, b] = await Promise.allSettled([
      this.standard.recallForDraft(draft, k),
      this.vault.recallForDraft(draft, k),
    ]);
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    const merged = new Map<string, Suggestion>();
    for (const r of [a, b])
      if (r.status === 'fulfilled') for (const s of r.value) merged.set(s.ref, s);
    return [...merged.values()].sort((x, y) => y.score - x.score).slice(0, k);
  }

  saveFact(fact: CandidateFact): Promise<SaveResult> {
    return this.vault.saveFact(fact);
  }

  async list(filter: ListFilter): Promise<LibraryPage> {
    const { cursor, ...rest } = filter;
    if (rest.query !== undefined && rest.query.trim().length > 0) {
      const [a, b] = await Promise.all([
        this.standard.items(rest, PAGE_SIZE),
        this.vault.items(rest, PAGE_SIZE),
      ]);
      return { items: interleave(a, b).slice(0, PAGE_SIZE), nextCursor: null };
    }
    const offset = offsetOf(cursor);
    const want = offset + PAGE_SIZE + 1;
    const [a, b] = await Promise.all([
      this.standard.items(rest, want),
      this.vault.items(rest, want),
    ]);
    const merged = [...a, ...b].sort(newestFirst);
    const items = merged.slice(offset, offset + PAGE_SIZE);
    return {
      items,
      nextCursor: merged.length > offset + PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
    };
  }

  async hide(ref: string): Promise<void> {
    await (await this.holderOf(ref)).hide(ref);
  }

  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void> {
    const engine = (await this.vault.ownsConflict(conflictId)) ? this.vault : this.standard;
    await engine.resolveConflict(conflictId, resolution);
  }

  async exportAll(): Promise<StoredMemory[]> {
    const [a, b] = await Promise.all([this.standard.exportAll(), this.vault.exportAll()]);
    return [...a, ...b];
  }

  /** Both engines share one governor (one key budget), so either reports the same state. */
  governor(): GovernorStatus {
    const v = this.vault.governor();
    return v.kind !== 'ready' ? v : this.standard.governor();
  }

  destroy(): void {
    this.vault.destroy();
    this.standard.destroy();
  }

  private async holderOf(ref: string): Promise<PartPort> {
    return (await this.vault.owns(ref)) ? this.vault : this.standard;
  }
}

/** Busy states that mean a queue still has work in flight. */
const BUSY: ReadonlySet<ImportProgress['state']> = new Set([
  'writing',
  'cooling_down',
  'paused',
  'error',
]);

/**
 * Imports queued before the switch finish in Standard mode (they were promised that way);
 * everything enqueued afterwards goes to Vault. Progress shows whichever queue is working.
 */
export class SplitQueuePort implements ImportQueuePort {
  constructor(
    private readonly standard: ImportQueuePort,
    private readonly vault: ImportQueuePort,
  ) {}

  enqueue(facts: readonly CandidateFact[]): Promise<{ queued: number }> {
    return this.vault.enqueue(facts);
  }

  progress(): ImportProgress {
    const s = this.standard.progress();
    return BUSY.has(s.state) ? s : this.vault.progress();
  }

  subscribe(listener: (progress: ImportProgress) => void): () => void {
    const emit = () => listener(this.progress());
    const a = this.standard.subscribe(emit);
    const b = this.vault.subscribe(emit);
    return () => {
      a();
      b();
    };
  }
}
