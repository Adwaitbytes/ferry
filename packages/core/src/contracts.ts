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
/* Extension responses: the `data` of a successful WorkerResult.       */
/* The worker parses its own output with these before replying, and     */
/* the web app parses again on receipt, so the two can never drift.     */
/* ------------------------------------------------------------------ */

export const AccountId = z.string().regex(/^0x[0-9a-f]{64}$/);
export const PublicKeyHex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Short key fingerprint shown in the side panel and the web app before the pairing signature
 * (THREAT_MODEL X-PAIR-1): first 8 and last 8 hex characters of the 32-byte key, in groups of 4.
 * Derived from the public key alone, so the web app recomputes it from the exact bytes it puts into
 * `add_delegate_key` and the user compares the two.
 */
export const KeyFingerprint = z.string().regex(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);

export function keyFingerprint(publicKeyHex: string): string {
  const hex = publicKeyHex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new RangeError('keyFingerprint: expected a 32-byte hex public key');
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(56, 60), hex.slice(60, 64)].join(' ');
}

export const LockState = z.enum(['uninitialized', 'locked', 'open']);
export type LockState = z.infer<typeof LockState>;

/** Mirrors the memwal RateGovernor state; `resumeAt` is epoch milliseconds. */
export const GovernorStatus = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({
    kind: z.literal('cooling_down'),
    reason: z.enum(['rate_limited', 'upstream_unavailable', 'pacing']),
    resumeAt: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('key_rejected') }),
]);
export type GovernorStatus = z.infer<typeof GovernorStatus>;

export const AdapterHealth = z.object({ ok: z.boolean(), detail: z.string().max(200), at: z.number().int().nonnegative() });
export type AdapterHealth = z.infer<typeof AdapterHealth>;

export const RecentCapture = z.object({
  id: z.string().max(64),
  site: Site,
  text: z.string().max(MAX_FACT_CHARS),
  at: z.number().int().nonnegative(),
  state: z.enum(['offered', 'saved', 'auto_saved', 'dismissed', 'conflict', 'failed']),
});
export type RecentCapture = z.infer<typeof RecentCapture>;

export const ExtensionStatus = z.object({
  lock: LockState,
  locked: z.boolean(),
  paired: z.boolean(),
  accountId: AccountId.nullable(),
  publicKeyHex: PublicKeyHex.nullable(),
  fingerprint: KeyFingerprint.nullable(),
  suiAddress: z.string().max(80).nullable(),
  account: z.object({ accountId: AccountId, owner: z.string().max(80), pairedAt: z.iso.datetime() }).nullable(),
  autoLockMinutes: z.number().int().positive(),
  msUntilAutoLock: z.number().int().nonnegative().nullable(),
  governor: GovernorStatus,
  importProgress: ImportProgress,
  /** Side panel only: never sent to the web app, which has no use for unsaved capture text. */
  adapters: z.partialRecord(Site, AdapterHealth).optional(),
  recentCaptures: z.array(RecentCapture).max(50).optional(),
});
export type ExtensionStatus = z.infer<typeof ExtensionStatus>;

export const PairingOffer = z.object({
  publicKeyHex: PublicKeyHex,
  suiAddress: z.string().max(80),
  fingerprint: KeyFingerprint,
  label: z.string().max(64),
  accountId: AccountId.nullable(),
});
export type PairingOffer = z.infer<typeof PairingOffer>;

export const PairingConfirmation = z.object({ accountId: AccountId, owner: z.string().max(80) });
export type PairingConfirmation = z.infer<typeof PairingConfirmation>;

/**
 * An open F5 conflict, attached to the stored memory the new fact disputes. The new fact is not on
 * Walrus yet, so `otherRef` is its candidate id; a `keep_new` or `merge` resolution supersedes the
 * item's own `memory.ref`.
 */
export const LibraryConflict = z.object({
  conflictId: z.uuid(),
  otherRef: MemoryRef,
  otherText: z.string().max(MAX_FACT_CHARS),
  otherSources: z.array(Vendor).min(1),
  otherHeardAt: z.iso.date(),
  verdict: z.enum(['contradicts', 'refines']),
});
export type LibraryConflict = z.infer<typeof LibraryConflict>;

export const LibraryItem = z.object({
  memory: StoredMemory,
  endEpoch: z.number().int().nonnegative().nullable(),
  blobId: z.string().max(128),
  conflict: LibraryConflict.optional(),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const LibraryPage = z.object({
  items: z.array(LibraryItem),
  nextCursor: z.string().max(200).nullable(),
});
export type LibraryPage = z.infer<typeof LibraryPage>;

/** Outcome of saving one fact. Same discriminant as memwal `FactWriteResult`, plus the F5 outcomes. */
export const SaveResult = z.discriminatedUnion('status', [
  z.object({ factId: z.string().max(64), status: z.literal('written'), ref: MemoryRef }),
  z.object({ factId: z.string().max(64), status: z.literal('pending') }),
  z.object({ factId: z.string().max(64), status: z.literal('failed') }),
  z.object({ factId: z.string().max(64), status: z.literal('quarantined') }),
  z.object({ factId: z.string().max(64), status: z.literal('blocked'), categories: z.array(SensitiveCategory) }),
  z.object({ factId: z.string().max(64), status: z.literal('merged'), ref: MemoryRef }),
  z.object({
    factId: z.string().max(64),
    status: z.literal('conflict'),
    conflictId: z.uuid(),
    verdict: z.enum(['contradicts', 'refines']),
  }),
]);
export type SaveResult = z.infer<typeof SaveResult>;

export const ImportEnqueued = z.object({
  queued: z.number().int().nonnegative(),
  /** Facts in an always-blocked category, refused before they reach the queue. */
  dropped: z.number().int().nonnegative(),
});
export type ImportEnqueued = z.infer<typeof ImportEnqueued>;

export const ExportBundle = z.object({
  /** PAM v1.0 JSON text, ready to save as a file. */
  pam: z.string(),
  markdown: z.string(),
  count: z.number().int().nonnegative(),
});
export type ExportBundle = z.infer<typeof ExportBundle>;

/** `data` schema for each WebAppRequest type. */
export const WebAppResponse = {
  'status.get': ExtensionStatus,
  'pairing.begin': PairingOffer,
  'pairing.confirm': PairingConfirmation,
  'import.enqueue': ImportEnqueued,
  'import.progress': ImportProgress,
  'memory.list': LibraryPage,
  'memory.recall': z.array(Suggestion).max(20),
  'memory.save': SaveResult,
  'memory.hide': z.object({ hidden: MemoryRef }),
  'memory.resolve': z.object({ resolved: z.uuid() }),
  'data.export': ExportBundle,
} as const satisfies Record<WebAppRequest['type'], z.ZodType>;
export type WebAppResponse<T extends WebAppRequest['type']> = z.infer<(typeof WebAppResponse)[T]>;

/** `data` schema for each PanelRequest type except settings, whose shape is extension-internal. */
export const PanelResponse = {
  ...WebAppResponse,
  lock: ExtensionStatus,
  unlock: ExtensionStatus,
  'data.wipe': ExtensionStatus,
} as const satisfies Record<Exclude<PanelRequest['type'], 'settings.get' | 'settings.set'>, z.ZodType>;

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

/*
 * Gate management API, used by the web app with a SIWS bearer session. Amounts are decimal strings
 * of USDC micros so no float ever touches money.
 */
const SuiAddress = z.string().regex(/^0x[0-9a-f]{64}$/);
const MicrosText = z.string().regex(/^\d{1,20}$/);

export const GateNonce = z.object({
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  expiresAt: z.iso.datetime(),
  /** Host the SIWS message must name; the Gate binds sessions to it. */
  domain: z.string().min(1).max(253),
});
export type GateNonce = z.infer<typeof GateNonce>;

export const GateSession = z.object({ token: z.string().min(1).max(2000), address: SuiAddress, expiresAt: z.iso.datetime() });
export type GateSession = z.infer<typeof GateSession>;

/** Who may publish cards (the Public profile account owner) and which account the Gate reads. */
export const GateProfile = z.object({
  publicAccountId: SuiObjectId,
  owner: SuiAddress,
  namespace: z.literal('ferry-public'),
});
export type GateProfile = z.infer<typeof GateProfile>;

export const GateCard = z.object({
  id: CardId,
  name: z.string().max(60),
  scopeLabel: z.string().max(40),
  priceMicros: MicrosText,
  price: z.string().max(32),
  currency: z.string().max(200),
  recipient: SuiAddress,
});
export type GateCard = z.infer<typeof GateCard>;

export const GateOwnerCard = GateCard.extend({
  dailyCap: z.number().int().positive(),
  allowedAgents: z.array(SuiAddress).max(20),
  enabled: z.boolean(),
  killed: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type GateOwnerCard = z.infer<typeof GateOwnerCard>;

export const GateCardList = z.object({ cards: z.array(GateOwnerCard) });
export type GateCardList = z.infer<typeof GateCardList>;

export const GateEarnings = z.object({
  owner: SuiAddress,
  currency: z.string().max(200),
  totals: z.object({
    count: z.number().int().nonnegative(),
    totalMicros: MicrosText,
    total: z.string().max(32),
    todayMicros: MicrosText,
    today: z.string().max(32),
    usdcUsd: z.string().max(32).nullable(),
    totalUsd: z.string().max(32).nullable(),
    priceSource: z.literal('tatum').nullable(),
  }),
  payments: z.array(
    z.object({
      receiptId: z.string().max(64),
      cardId: CardId,
      cardName: z.string().max(60),
      agent: SuiAddress,
      querySha256: z.string().regex(/^[0-9a-f]{64}$/),
      amountMicros: MicrosText,
      amount: z.string().max(32),
      digest: z.string().max(64),
      explorerUrl: z.url({ protocol: /^https$/ }),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type GateEarnings = z.infer<typeof GateEarnings>;

/*
 * Publishing to the Public profile account (scripts/publish-public.ts). The Share page exports the
 * facts the user approved in this shape; the script writes them to `ferry-public`.
 */

/**
 * Stands in for the conversation and quote hashes (`c=` and `q=`) of a published fact. The Gate
 * drops both anyway (X-GATE-3); writing a constant means even the stored header cannot be linked
 * back to a private conversation.
 */
export const PUBLIC_REDACTED_HASH = 'ferry-public-redacted';
export const MAX_PUBLISH_FACTS = 200;

export const PublishableFact = z.object({
  text: z.string().trim().min(1).max(MAX_FACT_CHARS),
  type: FactType,
  sources: z.array(Vendor).min(1).max(6).default(['manual']),
  heardAt: z.iso.date().optional(),
});
export type PublishableFact = z.input<typeof PublishableFact>;

export const PublishableFacts = z.array(PublishableFact).min(1).max(MAX_PUBLISH_FACTS);

/** A publishable fact as a candidate: one redacted receipt per source, so `s=` keeps every vendor. */
export function publishableToCandidate(input: PublishableFact, id: string, today: string): CandidateFact {
  const fact = PublishableFact.parse(input);
  const messageAt = `${fact.heardAt ?? today}T00:00:00Z`;
  return CandidateFact.parse({
    id,
    text: fact.text,
    type: fact.type,
    receipts: [...new Set(fact.sources)].map((vendor) => ({
      vendor,
      conversationIdHash: PUBLIC_REDACTED_HASH,
      messageAt,
      quote: '',
      quoteHash: PUBLIC_REDACTED_HASH,
      confidence: 1,
    })),
    sensitive: [],
    flags: [],
  });
}

/* Re-exported so consumers import every contract from one place. */
export { Receipt, StoredMemory };
