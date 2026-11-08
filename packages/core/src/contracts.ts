import { z } from 'zod';
import {
  CandidateFact,
  ConflictResolution,
  ConflictVerdict,
  FactType,
  MAX_FACT_CHARS,
  MAX_QUOTE_CHARS,
  MemoryRef,
  MemoryStatus,
  Receipt,
  SensitiveCategory,
  ShortHash,
  StoredMemory,
  Vendor,
} from './schemas.js';

/* ------------------------------------------------------------------ */
/* Extension messaging. Validated with zod on BOTH ends (PRD 5.2).     */
/* ------------------------------------------------------------------ */

export const Site = z.enum(['chatgpt', 'claude', 'gemini']);
export type Site = z.infer<typeof Site>;

/** Who may send what. The worker enforces this from `sender`, never from the payload. */
export type MessageOrigin = 'content' | 'extension_page' | 'web_app';

/** A recall suggestion as shown in the composer chip and preview. */
export const Suggestion = z.object({
  ref: MemoryRef,
  text: z.string().max(MAX_FACT_CHARS),
  type: FactType,
  sources: z.array(Vendor).min(1),
  heardAt: z.iso.date(),
  score: z.number(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const ContentRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('adapter.health'), site: Site, ok: z.boolean(), detail: z.string().max(200) }),
  z.object({
    type: z.literal('capture.propose'),
    site: Site,
    userText: z.string().min(1).max(8000),
    conversationUrl: z.url({ protocol: /^https$/ }).optional(),
  }),
  z.object({ type: z.literal('capture.save'), site: Site, fact: CandidateFact }),
  z.object({ type: z.literal('recall.suggest'), site: Site, draft: z.string().max(4000) }),
  z.object({ type: z.literal('inject.compose'), site: Site, refs: z.array(MemoryRef).min(1).max(20) }),
  z.object({ type: z.literal('panel.open') }),
]);
export type ContentRequest = z.infer<typeof ContentRequest>;

export const PanelRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status.get') }),
  z.object({ type: z.literal('pairing.begin') }),
  z.object({ type: z.literal('pairing.confirm'), accountId: z.string().regex(/^0x[0-9a-f]{64}$/) }),
  z.object({ type: z.literal('lock') }),
  z.object({ type: z.literal('unlock'), passphrase: z.string().min(8).max(256) }),
  z.object({
    type: z.literal('memory.list'),
    status: MemoryStatus.optional(),
    query: z.string().max(500).optional(),
    cursor: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('memory.recall'), query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('memory.save'), fact: CandidateFact }),
  z.object({ type: z.literal('memory.hide'), ref: MemoryRef }),
  z.object({ type: z.literal('memory.resolve'), conflictId: z.uuid(), resolution: ConflictResolution }),
  z.object({ type: z.literal('import.enqueue'), facts: z.array(CandidateFact).min(1).max(2000) }),
  z.object({ type: z.literal('import.progress') }),
  z.object({ type: z.literal('settings.get') }),
  z.object({ type: z.literal('settings.set'), patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('data.export') }),
  z.object({ type: z.literal('data.wipe'), confirm: z.literal('DELETE MY FERRY DATA') }),
]);
export type PanelRequest = z.infer<typeof PanelRequest>;

/**
 * Messages the Ferry web origin may send via externally_connectable. The relayer has no CORS
 * header (RESEARCH 1.7), so the web app reaches memory only through the extension, which holds
 * the delegate key. Destructive local actions (wipe, lock settings) stay panel-only.
 */
export const WebAppRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status.get') }),
  z.object({ type: z.literal('pairing.begin') }),
  z.object({ type: z.literal('pairing.confirm'), accountId: z.string().regex(/^0x[0-9a-f]{64}$/) }),
  z.object({ type: z.literal('import.enqueue'), facts: z.array(CandidateFact).min(1).max(2000) }),
  z.object({ type: z.literal('import.progress') }),
  z.object({
    type: z.literal('memory.list'),
    status: MemoryStatus.optional(),
    query: z.string().max(500).optional(),
    cursor: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('memory.recall'), query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('memory.save'), fact: CandidateFact }),
  z.object({ type: z.literal('memory.hide'), ref: MemoryRef }),
  z.object({ type: z.literal('memory.resolve'), conflictId: z.uuid(), resolution: ConflictResolution }),
  z.object({ type: z.literal('data.export') }),
]);
export type WebAppRequest = z.infer<typeof WebAppRequest>;

export const WorkerError = z.object({
  ok: z.literal(false),
  code: z.enum(['invalid_message', 'forbidden_sender', 'locked', 'not_paired', 'cooling_down', 'key_rejected', 'upstream', 'internal']),
  message: z.string().max(300),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type WorkerError = z.infer<typeof WorkerError>;

export type WorkerResult<T> = { ok: true; data: T } | WorkerError;

export const ImportProgress = z.object({
  total: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Blocked or quarantined facts: never written, shown separately so totals stay honest. */
  skipped: z.number().int().nonnegative().optional(),
  state: z.enum(['idle', 'writing', 'cooling_down', 'paused', 'done', 'error']),
  resumeAt: z.iso.datetime().optional(),
});
export type ImportProgress = z.infer<typeof ImportProgress>;

/* ------------------------------------------------------------------ */
/* Ferry HTTP APIs. Bodies are never logged (PRD 6.2).                 */
/* ------------------------------------------------------------------ */

export const MAX_DISTILL_CHUNKS = 16;
export const MAX_CHUNK_CHARS = 6000;

export const DistillRequest = z.object({
  chunks: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(64),
        vendor: Vendor,
        conversationIdHash: ShortHash,
        messageAt: z.iso.datetime({ offset: true }),
        userText: z.string().min(1).max(MAX_CHUNK_CHARS),
        assistantContext: z.string().max(1000).optional(),
      }),
    )
    .min(1)
    .max(MAX_DISTILL_CHUNKS),
});
export type DistillRequest = z.infer<typeof DistillRequest>;

export const DistilledFact = z.object({
  chunkId: z.string().min(1).max(64),
  text: z.string().min(1).max(MAX_FACT_CHARS),
  type: FactType,
  quote: z.string().max(MAX_QUOTE_CHARS),
  confidence: z.number().min(0).max(1),
  sensitive: z.array(SensitiveCategory),
  injectionSuspect: z.boolean(),
});
export type DistilledFact = z.infer<typeof DistilledFact>;

export const DistillResponse = z.object({ facts: z.array(DistilledFact) });
export type DistillResponse = z.infer<typeof DistillResponse>;

export const JudgeRequest = z.object({
  fact: z.object({ text: z.string().min(1).max(MAX_FACT_CHARS), type: FactType }),
  neighbors: z.array(z.object({ ref: MemoryRef, text: z.string().max(MAX_FACT_CHARS) })).max(10),
});
export type JudgeRequest = z.infer<typeof JudgeRequest>;

export const JudgeResponse = z.object({
  verdicts: z.array(z.object({ ref: MemoryRef, verdict: ConflictVerdict, reason: z.string().max(200) })),
});
export type JudgeResponse = z.infer<typeof JudgeResponse>;

export const DeskProvider = z.enum(['claude', 'gpt', 'gemini']);
export type DeskProvider = z.infer<typeof DeskProvider>;

export const DeskRequest = z.object({
  provider: DeskProvider,
  /** Set by the Blackout Drill to simulate a provider cutting the user off. */
  cutOff: z.array(DeskProvider).max(3),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(40),
  context: z.array(z.object({ ref: MemoryRef, text: z.string().max(MAX_FACT_CHARS) })).max(20),
});
export type DeskRequest = z.infer<typeof DeskRequest>;

/** Chain proxy: Tatum gRPC reads on behalf of the extension, so the Tatum key never ships. */
export const SuiObjectId = z.string().regex(/^0x[0-9a-f]{1,64}$/);

export const DelegateKeyInfo = z.object({
  /** Same format as MEMWAL_AGENT_ID: 32-byte Ed25519 key, lowercase hex, no 0x. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  suiAddress: z.string(),
  label: z.string(),
  createdAt: z.iso.datetime().nullable(),
});
export type DelegateKeyInfo = z.infer<typeof DelegateKeyInfo>;

export const AccountView = z.object({
  accountId: SuiObjectId,
  owner: z.string(),
  active: z.boolean(),
  delegates: z.array(DelegateKeyInfo),
  version: z.string(),
  createdAt: z.iso.datetime().nullable().optional(),
  adminQuarantined: z.boolean().optional(),
  /** Seal identity component; bumps when a delegate is removed. */
  accessCounterVersion: z.string().optional(),
});
export type AccountView = z.infer<typeof AccountView>;

export const BlobView = z.object({
  blobId: z.string(),
  objectId: SuiObjectId.nullable(),
  owner: z.string().nullable(),
  certifiedEpoch: z.number().int().nullable(),
  endEpoch: z.number().int().nullable(),
  currentEpoch: z.number().int(),
});
export type BlobView = z.infer<typeof BlobView>;

/* ------------------------------------------------------------------ */
/* Ferry Gate                                                          */
/* ------------------------------------------------------------------ */

/** 128-bit base64url card id. */
export const CardId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

export const GateRecallQuery = z.object({ q: z.string().min(1).max(300) });

export const GateRecallResult = z.object({
  cardId: CardId,
  results: z.array(
    z.object({
      text: z.string().max(MAX_FACT_CHARS),
      type: FactType,
      sources: z.array(Vendor),
      heardAt: z.iso.date(),
      memoryRef: MemoryRef,
    }),
  ),
  payment: z.object({ digest: z.string(), amountMicros: z.string(), receiptId: z.string(), payer: z.string() }),
});
export type GateRecallResult = z.infer<typeof GateRecallResult>;

/* Re-exported so consumers import every contract from one place. */
export { Receipt, StoredMemory };
