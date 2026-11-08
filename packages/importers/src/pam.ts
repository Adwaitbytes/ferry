import type { FactType, Receipt, StoredMemory, Vendor } from '@ferry/core';
import { canonicalize } from './jcs.js';

/**
 * Portable AI Memory v1.0 export (https://portable-ai-memory.pages.dev, spec dated 2026-02-17,
 * schema $id https://schemas.portable-ai-memory.org/v1.0/memory-store.schema.json). Pinned: a new
 * PAM version means a new mapping, not a silent change to this one.
 */
export const PAM_SCHEMA = 'portable-ai-memory';
export const PAM_SCHEMA_VERSION = '1.0';
export const PAM_SPEC_URI = 'https://portable-ai-memory.org/spec/v1.0';
export const FERRY_EXPORTER = 'ferry/0.1.0';

export type PamMemoryType =
  | 'fact'
  | 'preference'
  | 'skill'
  | 'context'
  | 'relationship'
  | 'goal'
  | 'instruction'
  | 'identity'
  | 'environment'
  | 'project'
  | 'custom';
export type PamStatus = 'active' | 'superseded' | 'deprecated' | 'retracted' | 'archived';

export interface PamMemory {
  id: string;
  type: PamMemoryType;
  /** Set exactly when `type` is `custom` (schema if/then/else). */
  custom_type: string | null;
  status: PamStatus;
  content: string;
  content_hash: string;
  tags: string[];
  confidence: { initial: number; current: number; decay_model: null };
  temporal: { created_at: string; updated_at: string; superseded_by: string | null };
  provenance: {
    platform: string;
    conversation_ref: string | null;
    extraction_method: 'llm_inference' | 'manual' | 'explicit_user_input';
    extracted_at: string;
    extractor: string;
  };
  embedding_ref: null;
  metadata: { ferry: { ref: string; type: FactType; sources: Vendor[]; receipts: Receipt[] } };
}

export interface PamConversationIndexEntry {
  id: string;
  platform: string;
  temporal: { created_at: string };
  derived_memories: string[];
}

export interface PamDocument {
  schema: typeof PAM_SCHEMA;
  schema_version: typeof PAM_SCHEMA_VERSION;
  spec_uri: string;
  export_id: string;
  exported_by: string;
  export_date: string;
  export_type: 'full';
  owner: { id: string };
  memories: PamMemory[];
  conversations_index: PamConversationIndexEntry[];
  integrity: { canonicalization: 'RFC8785'; checksum: string; total_memories: number };
}

export interface PamOptions {
  /** PAM owner id. SHOULD be a UUID; defaults to a fresh random one. */
  ownerId?: string;
  exportId?: string;
  now?: Date;
  /** Hidden memories are left out unless asked for; they export as `retracted`. */
  includeHidden?: boolean;
}

/**
 * Ferry has eleven types; PAM has a closed set plus `custom`. Types with no faithful PAM
 * equivalent export as `custom` so their meaning survives (RESEARCH section 7). The Ferry type is
 * also kept as a tag and in metadata.
 */
const TYPE_MAP: Readonly<Record<FactType, PamMemoryType>> = {
  identity: 'identity',
  preference: 'preference',
  dislike: 'custom',
  person: 'relationship',
  project: 'project',
  goal: 'goal',
  routine: 'custom',
  decision: 'custom',
  skill: 'skill',
  constraint: 'instruction',
  lesson: 'custom',
};

/** PAM platform ids are product names (spec 11.4). Ferry's own chat is `ferry`. */
const PLATFORM: Readonly<Record<Vendor, string>> = {
  chatgpt: 'chatgpt',
  claude: 'claude',
  gemini: 'gemini',
  paste: 'paste',
  desk: 'ferry',
  manual: 'manual',
};

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PAM spec 6.1: trim, lowercase, NFC, collapse whitespace; then sha256 (6.2). */
export async function pamContentHash(content: string): Promise<string> {
  const normalized = content.trim().toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean).join(' ');
  return `sha256:${await sha256Hex(normalized)}`;
}

/**
 * Stable id per memory ref, shaped as a UUID v4 for consumers that check the version nibble.
 * Deterministic so exporting twice yields the same ids and PAM-side dedupe works.
 */
export async function pamIdFor(ref: string): Promise<string> {
  const hex = (await sha256Hex(`ferry-pam:${ref}`)).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function conversationRef(receipt: Receipt): string {
  return receipt.conversationId ?? `hash:${receipt.conversationIdHash}`;
}

function exportable(memory: StoredMemory, includeHidden: boolean): boolean {
  if (memory.status === 'quarantine') return false;
  if (memory.status === 'hidden') return includeHidden;
  return memory.text.trim().length > 0;
}

function pamStatus(memory: StoredMemory): PamStatus {
  if (memory.status === 'superseded') return 'superseded';
  if (memory.status === 'hidden') return 'retracted';
  return 'active';
}

/** Maps Ferry memories to a PAM v1.0 memory store. Quarantined memories are never exported. */
export async function toPam(memories: readonly StoredMemory[], opts: PamOptions = {}): Promise<PamDocument> {
  const now = (opts.now ?? new Date()).toISOString();
  const selected = memories.filter((m) => exportable(m, opts.includeHidden === true));
  const ids = new Map<string, string>();
  for (const memory of selected) ids.set(memory.ref, await pamIdFor(memory.ref));

  const conversations = new Map<string, PamConversationIndexEntry>();
  const out: PamMemory[] = [];
  for (const memory of selected) {
    const id = ids.get(memory.ref) as string;
    const receipts = [...memory.receipts].sort((a, b) => a.messageAt.localeCompare(b.messageAt));
    const first = receipts[0];
    const sources = memory.header.sources;
    const primary = sources[0] ?? 'manual';
    const tags = [...new Set<string>([memory.header.type, ...sources, ...(memory.status === 'conflict' ? ['conflict'] : [])])];
    out.push({
      id,
      type: TYPE_MAP[memory.header.type],
      custom_type: TYPE_MAP[memory.header.type] === 'custom' ? memory.header.type : null,
      status: pamStatus(memory),
      content: memory.text,
      content_hash: await pamContentHash(memory.text),
      tags,
      confidence: { initial: memory.header.confidence, current: memory.header.confidence, decay_model: null },
      temporal: {
        created_at: first ? new Date(first.messageAt).toISOString() : memory.writtenAt,
        updated_at: memory.writtenAt,
        superseded_by: memory.supersededBy ? (ids.get(memory.supersededBy) ?? null) : null,
      },
      provenance: {
        platform: PLATFORM[primary],
        conversation_ref: first ? conversationRef(first) : null,
        extraction_method: primary === 'manual' ? 'manual' : 'llm_inference',
        extracted_at: memory.writtenAt,
        extractor: FERRY_EXPORTER,
      },
      embedding_ref: null,
      metadata: { ferry: { ref: memory.ref, type: memory.header.type, sources: [...sources], receipts } },
    });
    for (const receipt of receipts) {
      const ref = conversationRef(receipt);
      const entry = conversations.get(ref) ?? {
        id: ref,
        platform: PLATFORM[receipt.vendor],
        temporal: { created_at: new Date(receipt.messageAt).toISOString() },
        derived_memories: [],
      };
      if (!entry.derived_memories.includes(id)) entry.derived_memories.push(id);
      conversations.set(ref, entry);
    }
  }

  const sorted = [...out].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schema: PAM_SCHEMA,
    schema_version: PAM_SCHEMA_VERSION,
    spec_uri: PAM_SPEC_URI,
    export_id: opts.exportId ?? crypto.randomUUID(),
    exported_by: FERRY_EXPORTER,
    export_date: now,
    export_type: 'full',
    owner: { id: opts.ownerId ?? crypto.randomUUID() },
    memories: out,
    conversations_index: [...conversations.values()],
    integrity: {
      canonicalization: 'RFC8785',
      checksum: `sha256:${await sha256Hex(canonicalize(sorted))}`,
      total_memories: out.length,
    },
  };
}
