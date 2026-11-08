import type {
  AccountView,
  BlobView,
  CandidateFact,
  ConflictResolution,
  DistilledFact,
  ImportProgress,
  JudgeRequest,
  JudgeResponse,
  MemoryStatus,
  Site,
  StoredMemory,
  Suggestion,
} from '@ferry/core';

/**
 * Ports keep the router and lock machine free of `chrome.*` and of the MemWal SDK, so the security
 * properties (sender checks, lock, budgets) are unit tested without a browser or network.
 */

/** A key-value area shaped like `chrome.storage.local` / `chrome.storage.session`. */
export interface StorageArea {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** The passphrase-sealed seed as stored at rest. Opaque to the extension; produced by memwal. */
export type SealedSeed = unknown;

/** Key handling from packages/memwal (sealSeed/openSeed/generateSeed/publicKeyHex). */
export interface VaultCrypto {
  generateSeed(): Uint8Array;
  sealSeed(seed: Uint8Array, passphrase: string): Promise<SealedSeed>;
  /** Rejects on a wrong passphrase or tampered ciphertext. */
  openSeed(sealed: SealedSeed, passphrase: string): Promise<Uint8Array>;
  publicKeyHex(seed: Uint8Array): Promise<string>;
  suiAddress(seed: Uint8Array): Promise<string>;
}

export type WriteOutcome =
  | { kind: 'written'; ref: string }
  | { kind: 'pending' }
  | { kind: 'conflict'; conflictId: string; verdict: 'contradicts' | 'refines' }
  | { kind: 'merged'; ref: string }
  | { kind: 'quarantined' }
  | { kind: 'blocked'; categories: string[] }
  | { kind: 'failed' };

export interface LibraryItem {
  memory: StoredMemory;
  endEpoch: number | null;
  blobId: string;
}

export interface LibraryPage {
  items: LibraryItem[];
  nextCursor: string | null;
}

/** The memory engine (packages/memwal FerryMemory), one long-lived instance per open session. */
export interface MemoryPort {
  recallForDraft(draft: string, k: number): Promise<Suggestion[]>;
  /** Writes one fact after a neighbor check; contradictions become conflict records (F5). */
  saveFact(fact: CandidateFact): Promise<WriteOutcome>;
  list(filter: { status?: MemoryStatus; query?: string; cursor?: string }): Promise<LibraryPage>;
  hide(ref: string): Promise<void>;
  resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;
  exportAll(): Promise<StoredMemory[]>;
  destroy(): void;
}

export interface ImportQueuePort {
  enqueue(facts: readonly CandidateFact[]): Promise<{ queued: number }>;
  progress(): ImportProgress;
  subscribe(listener: (progress: ImportProgress) => void): () => void;
}

export interface EngineFactory {
  create(input: {
    seed: Uint8Array;
    accountId: string;
  }): Promise<{ engine: MemoryPort; imports: ImportQueuePort }>;
}

/** The Ferry server, reached over HTTPS with host permission. Never receives the key. */
export interface FerryApi {
  getAccount(accountId: string): Promise<AccountView>;
  getBlob(blobId: string): Promise<BlobView>;
  /** One-chunk `POST /api/distill`. The server screens too; the worker screens again locally. */
  distillMessage(input: {
    site: Site;
    userText: string;
    conversationIdHash: string;
    messageAt: string;
  }): Promise<DistilledFact[]>;
  judge(request: JudgeRequest): Promise<JudgeResponse>;
}

export interface Clock {
  now(): number;
}
