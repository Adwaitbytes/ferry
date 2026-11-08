import type { CandidateFact, ImportProgress, Site, Suggestion } from '@ferry/core';

/**
 * Response payloads (`WorkerResult<T>['data']`) for each request type. Requests themselves are the
 * frozen core schemas; these shapes are extension-internal and shared by worker, panel and content.
 */

export type LockStatus = 'uninitialized' | 'locked' | 'open';

export interface AdapterHealth {
  ok: boolean;
  detail: string;
  at: number;
}

export interface RecentCapture {
  id: string;
  site: Site;
  text: string;
  at: number;
  state: 'offered' | 'saved' | 'auto_saved' | 'dismissed' | 'conflict' | 'failed';
}

export interface StatusData {
  lock: LockStatus;
  publicKeyHex: string | null;
  fingerprint: string | null;
  suiAddress: string | null;
  account: { accountId: string; owner: string; pairedAt: string } | null;
  autoLockMinutes: number;
  msUntilAutoLock: number | null;
  import: ImportProgress;
  coolingDownUntil: number | null;
  adapters: Partial<Record<Site, AdapterHealth>>;
  recentCaptures: RecentCapture[];
}

export interface PairingBeginData {
  publicKeyHex: string;
  suiAddress: string;
  fingerprint: string;
  label: string;
  accountId: string | null;
}

export interface PairingConfirmData {
  accountId: string;
  owner: string;
}

export interface SuggestData {
  suggestions: Suggestion[];
}

export interface ComposeData {
  text: string;
  count: number;
}

export interface CaptureProposalData {
  proposal: { fact: CandidateFact; sensitive: boolean } | null;
  autoSaved: boolean;
}

export type SaveOutcomeData =
  | { kind: 'written'; ref: string }
  | { kind: 'pending' }
  | { kind: 'conflict'; conflictId: string; verdict: 'contradicts' | 'refines' }
  | { kind: 'merged'; ref: string }
  | { kind: 'quarantined' }
  | { kind: 'blocked'; categories: string[] }
  | { kind: 'failed' };

export interface ExportData {
  json: string;
  markdown: string;
  count: number;
}

/** Messages the worker sends to a content script (never from the page). */
export type WorkerToContent = { type: 'ferry.insert-suggested' };

export const IMPORT_PORT = 'ferry.import-progress';
