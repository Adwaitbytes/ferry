import type { DistillRequest, Vendor } from '@ferry/core';

/** One chunk as the Distill endpoint accepts it. */
export type DistillChunk = DistillRequest['chunks'][number];

/** Vendors that come from a file or paste import (never `desk` or `manual`). */
export type ImportVendor = Extract<Vendor, 'chatgpt' | 'claude' | 'gemini' | 'paste'>;

/** A single user-authored turn, already reduced to plain text. */
export interface UserTurn {
  text: string;
  /** Epoch milliseconds. */
  at: number;
  /** Preceding assistant text, trimmed to its tail. Context only: never quotable in a receipt. */
  assistantContext?: string;
}

/** Vendor-neutral view of one conversation (or one synthetic group, such as custom instructions). */
export interface NormalizedConversation {
  vendor: ImportVendor;
  id: string;
  title: string | null;
  /** Built from a vendor template plus a validated id, never copied from the import. */
  url: string | null;
  turns: UserTurn[];
}

/** Where a slice of a chunk's text came from, so a quote can be pinned to its own message time. */
export interface ChunkSegment {
  start: number;
  end: number;
  messageAt: string;
}

/** Local-only side table row. Holds raw ids and text, so it must never leave the device. */
export interface ChunkSource {
  chunkId: string;
  vendor: ImportVendor;
  conversationId: string;
  conversationTitle: string | null;
  conversationUrl: string | null;
  messageAt: string;
  rawUserText: string;
  segments: ChunkSegment[];
}

export interface ImportStats {
  files: number;
  conversations: number;
  userTurns: number;
  chunks: number;
  skippedConversations: number;
}

export interface ImportResult {
  vendor: ImportVendor;
  chunks: DistillChunk[];
  sources: ChunkSource[];
  stats: ImportStats;
}

export type ImportStage = 'reading' | 'inflating' | 'parsing' | 'chunking' | 'done';

export interface ImportProgressEvent {
  stage: ImportStage;
  filesParsed: number;
  conversations: number;
  chunks: number;
  bytesInflated: number;
}

/** Every way an import can fail. Callers switch on `kind`; nothing in this package throws strings. */
export type ImportError =
  | { kind: 'archive_too_large'; limit: number; actual: number }
  | { kind: 'not_a_zip' }
  | { kind: 'corrupt_zip'; detail: string }
  | { kind: 'too_many_entries'; limit: number }
  | { kind: 'unsafe_entry_name'; name: string }
  | { kind: 'unsupported_entry'; name: string; reason: 'encrypted' | 'compression_method' }
  | { kind: 'entry_too_large'; name: string; limit: number }
  | { kind: 'total_too_large'; limit: number }
  | { kind: 'zip_bomb'; name: string; ratio: number }
  | { kind: 'unrecognized_export' }
  | { kind: 'malformed_json'; file: string }
  | { kind: 'invalid_shape'; file: string; detail: string }
  | { kind: 'paste_too_large'; limit: number; actual: number }
  | { kind: 'empty_input' }
  | { kind: 'aborted' }
  | { kind: 'worker_failed'; detail: string };

export type Result<T, E = ImportError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

export interface ImportOptions {
  /** Fallback time when a source has no usable timestamp. Defaults to the time of the call. */
  now?: Date;
  signal?: AbortSignal;
  onProgress?: (event: ImportProgressEvent) => void;
  /** Max milliseconds of synchronous work between yields. */
  sliceBudgetMs?: number;
}
