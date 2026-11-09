import type {
  AccountView,
  BlobView,
  CandidateFact,
  ConflictResolution,
  DistilledFact,
  GovernorStatus,
  ImportProgress,
  JudgeRequest,
  JudgeResponse,
  LibraryPage,
  MemoryStatus,
  SaveResult,
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
  /** Seals a small secret (the Vault embedding key) under a key derived from the open seed. */
  sealSecret(seed: Uint8Array, purpose: string, secret: string): Promise<SealedSeed>;
  /** Rejects when the blob was sealed under another seed or purpose, or was altered. */
  openSecret(seed: Uint8Array, purpose: string, sealed: SealedSeed): Promise<string>;
}

/** The memory engine (packages/memwal FerryMemory), one long-lived instance per open session. */
export interface MemoryPort {
  recallForDraft(draft: string, k: number): Promise<Suggestion[]>;
  /** Writes one fact after a neighbor check; contradictions become conflict records (F5). */
  saveFact(fact: CandidateFact): Promise<SaveResult>;
  list(filter: { status?: MemoryStatus; query?: string; cursor?: string }): Promise<LibraryPage>;
  hide(ref: string): Promise<void>;
  resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;
  exportAll(): Promise<StoredMemory[]>;
  governor(): GovernorStatus;
  destroy(): void;
}

export interface ImportQueuePort {
  enqueue(facts: readonly CandidateFact[]): Promise<{ queued: number }>;
  progress(): ImportProgress;
  subscribe(listener: (progress: ImportProgress) => void): () => void;
}

/** Vault mode (F10): the user's own embedding provider. Lives only in the worker's memory. */
export interface VaultEngineConfig {
  apiKey: string;
  apiBase: string;
  model: string;
}

export interface EngineFactory {
  /** With `vault`, new writes go through client-side Seal encryption; reads span both modes. */
  create(input: {
    seed: Uint8Array;
    accountId: string;
    vault: VaultEngineConfig | null;
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
