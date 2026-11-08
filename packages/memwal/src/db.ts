import { Dexie, type Table } from 'dexie';
import type {
  ConflictRecord,
  JobRecord,
  KvRecord,
  MemoryRecord,
  QueueRecord,
  ReceiptRecord,
} from './types.js';

export interface FerryDbOptions {
  /** Override for environments without a global `indexedDB` (tests). */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

/**
 * The local index. One database per MemWal account so two paired accounts on one browser
 * can never read each other's rows.
 */
export class FerryDb extends Dexie {
  memories!: Table<MemoryRecord, string>;
  receipts!: Table<ReceiptRecord, [string, string]>;
  conflicts!: Table<ConflictRecord, string>;
  jobs!: Table<JobRecord, string>;
  queue!: Table<QueueRecord, number>;
  kv!: Table<KvRecord, string>;

  constructor(name: string, options: FerryDbOptions = {}) {
    super(name, options.indexedDB && options.IDBKeyRange ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange } : {});
    this.version(1).stores({
      memories: '&ref, status, type, heardAt, writtenAt, kind, memoryId, *sources',
      receipts: '&[ref+quoteHash], ref',
      conflicts: '&id, state, existingRef',
      jobs: '&idempotencyKey, state',
      queue: '++seq, &factId, state',
      kv: '&key',
    });
  }
}

export function dbNameForAccount(accountId: string): string {
  return `ferry-memory-${accountId.toLowerCase()}`;
}
