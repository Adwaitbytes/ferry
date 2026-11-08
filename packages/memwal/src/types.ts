import type {
  ConflictResolution,
  ConflictVerdict,
  FactType,
  FerryHeader,
  MemoryStatus,
  Namespace,
  Receipt,
  StoredMemory,
  Suggestion,
  Vendor,
  CandidateFact,
} from '@ferry/core';

/** Time source and sleeper. Injected so pacing and backoff are testable with fake timers. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, ms));
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortReason(signal as AbortSignal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

/**
 * What a local index row is.
 * - `fact`: a Ferry memory with a valid header.
 * - `tombstone`: a Ferry memory with `st=hidden`; it only exists to hide its `sup` target.
 * - `foreign`: text in a Ferry namespace without a valid header. Shown as unverified, never
 *   allowed to change another memory's state (THREAT_MODEL X-HDR-2).
 * - `unhydrated`: listed by `listMemories` (metadata only) but its text has not been recalled yet.
 */
export type RecordKind = 'fact' | 'tombstone' | 'foreign' | 'unhydrated';

export interface MemoryRecord {
  ref: string;
  namespace: Namespace;
  kind: RecordKind;
  factText: string;
  header: FerryHeader | null;
  status: MemoryStatus;
  /** Denormalized from the header so Dexie can index Library filters. */
  type: FactType | null;
  sources: Vendor[];
  heardAt: string | null;
  writtenAt: string;
  supersededBy: string | null;
  memoryId: string | null;
  endEpoch: number | null;
  expiresAt: string | null;
}

/** Full receipts stay on this device. They are never sent anywhere (PRD section 4). */
export interface ReceiptRecord {
  ref: string;
  quoteHash: string;
  receipt: Receipt;
}

export type ConflictState = 'open' | 'resolved';

export interface ConflictRecord {
  id: string;
  verdict: Extract<ConflictVerdict, 'contradicts' | 'refines'>;
  existingRef: string;
  newFact: CandidateFact;
  reason: string;
  state: ConflictState;
  createdAt: string;
  resolution: ConflictResolution | null;
  resultRefs: string[];
}

export interface JobItem {
  factId: string;
  memoryText: string;
  factText: string;
  header: FerryHeader;
  receipts: Receipt[];
  kind: 'fact' | 'tombstone';
}

export type JobState = 'pending' | 'submitted' | 'done';

/** A write batch. Persisted before the request goes out, so a worker restart can resume it. */
export interface JobRecord {
  idempotencyKey: string;
  namespace: Namespace;
  items: JobItem[];
  jobIds: string[] | null;
  state: JobState;
  createdAt: string;
  /** Per item: blob id when done, error when failed, null while pending. */
  outcomes: Array<{ blobId: string } | { error: string } | null>;
}

export type QueueItemState = 'queued' | 'written' | 'failed' | 'skipped' | 'pending';

export interface QueueRecord {
  seq?: number;
  factId: string;
  fact: CandidateFact;
  state: QueueItemState;
  ref: string | null;
  error: string | null;
}

export interface KvRecord {
  key: string;
  value: unknown;
}

export type FactWriteResult =
  | { factId: string; status: 'written'; ref: string }
  | { factId: string; status: 'pending'; jobKey: string }
  | { factId: string; status: 'failed'; error: string }
  | { factId: string; status: 'quarantined'; ref: string }
  | { factId: string; status: 'blocked'; categories: string[] };

export interface LibraryFilter {
  type?: FactType;
  vendor?: Vendor;
  /** Inclusive ISO dates (YYYY-MM-DD) on when the fact was heard. */
  from?: string;
  to?: string;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
}

export interface SyncReport {
  listed: number;
  added: number;
  updated: number;
  removed: number;
  unhydrated: number;
  resynced: boolean;
}

/** One version in a fact's history, oldest first. */
export interface TimelineEntry {
  memory: StoredMemory;
  isRequested: boolean;
}

export interface Neighbor {
  ref: string;
  text: string;
  distance: number;
  header: FerryHeader;
}

/** Judges a new fact against its neighbors. The LLM prompt lives in packages/distill. */
export type ConflictJudge = (request: {
  fact: { text: string; type: FactType };
  neighbors: Array<{ ref: string; text: string }>;
}) => Promise<{ verdicts: Array<{ ref: string; verdict: ConflictVerdict; reason: string }> }>;

export type ReconcileOutcome =
  | { kind: 'written'; result: FactWriteResult }
  | { kind: 'merged'; ref: string }
  | { kind: 'conflict'; conflictId: string; verdict: 'contradicts' | 'refines' };

export interface WriteOptions {
  namespace?: Namespace;
  /** Fact id to the ref it replaces. */
  supersedes?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

/** Shared by Standard (relayer) and Vault (client-side SEAL) modes. */
export interface FerryMemoryApi {
  writeFacts(facts: readonly CandidateFact[], opts?: WriteOptions): Promise<FactWriteResult[]>;
  recallForDraft(draft: string, k: number): Promise<Suggestion[]>;
  hide(ref: string): Promise<void>;
  supersede(oldRef: string, newFact: CandidateFact): Promise<FactWriteResult>;
  exportAll(): Promise<StoredMemory[]>;
  destroy(): void;
}
