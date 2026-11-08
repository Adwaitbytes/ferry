import { z } from 'zod';

/** Hard cap on a single fact sentence, after normalization (PRD 6.2). */
export const MAX_FACT_CHARS = 500;
/** Hard cap on a receipt quote (PRD F2.5). */
export const MAX_QUOTE_CHARS = 200;

export const FACT_TYPES = [
  'identity',
  'preference',
  'dislike',
  'person',
  'project',
  'goal',
  'routine',
  'decision',
  'skill',
  'constraint',
  'lesson',
] as const;
export const FactType = z.enum(FACT_TYPES);
export type FactType = z.infer<typeof FactType>;

/** Where a fact was heard. `desk` is Ferry's own in-app chat; `manual` is typed into Ferry. */
export const VENDORS = ['chatgpt', 'claude', 'gemini', 'paste', 'desk', 'manual'] as const;
export const Vendor = z.enum(VENDORS);
export type Vendor = z.infer<typeof Vendor>;

export const MEMORY_STATUSES = ['active', 'superseded', 'hidden', 'conflict', 'quarantine'] as const;
export const MemoryStatus = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.infer<typeof MemoryStatus>;

export const SENSITIVE_CATEGORIES = [
  'health',
  'finance',
  'government_id',
  'password',
  'card_number',
  'secret_key',
  'precise_location',
  'sexuality',
  'religion',
  'politics',
] as const;
export const SensitiveCategory = z.enum(SENSITIVE_CATEGORIES);
export type SensitiveCategory = z.infer<typeof SensitiveCategory>;

/** Categories that are never written, whatever the user chooses (PRD F2.7). */
export const ALWAYS_BLOCKED: readonly SensitiveCategory[] = [
  'government_id',
  'password',
  'card_number',
  'secret_key',
];

export const Namespace = z.enum(['ferry-core', 'ferry-receipts', 'ferry-events', 'ferry-public']);
export type Namespace = z.infer<typeof Namespace>;

const IsoDate = z.iso.datetime({ offset: true });
const Confidence = z.number().min(0).max(1);
/** base64url, as produced by `hashShort`. */
export const ShortHash = z.string().regex(/^[A-Za-z0-9_-]{8,43}$/);
/** Opaque Walrus Memory reference (blob id). Kept loose until research pins the exact shape. */
export const MemoryRef = z.string().min(8).max(128).regex(/^[A-Za-z0-9_\-:x]+$/);
export type MemoryRef = z.infer<typeof MemoryRef>;

/** Where one fact was heard. The raw conversation id and quote never leave the device in clear. */
export const Receipt = z.object({
  vendor: Vendor,
  conversationId: z.string().max(200).optional(),
  conversationIdHash: ShortHash,
  conversationUrl: z.url({ protocol: /^https$/ }).optional(),
  messageAt: IsoDate,
  quote: z.string().max(MAX_QUOTE_CHARS),
  quoteHash: ShortHash,
  confidence: Confidence,
});
export type Receipt = z.infer<typeof Receipt>;

export const InjectionFlag = z.enum([
  'imperative_to_ai',
  'exfil_url',
  'hidden_unicode',
  'encoded_payload',
  'header_forgery',
  'markup',
  'llm_classifier',
]);
export type InjectionFlag = z.infer<typeof InjectionFlag>;

/** A fact before it is written: produced by import, capture or Desk. */
export const CandidateFact = z.object({
  id: z.uuid(),
  text: z.string().min(1).max(MAX_FACT_CHARS),
  type: FactType,
  receipts: z.array(Receipt).min(1),
  sensitive: z.array(SensitiveCategory),
  flags: z.array(InjectionFlag),
});
export type CandidateFact = z.infer<typeof CandidateFact>;

/** The machine header appended to every memory text (PRD section 4). */
export const FerryHeader = z.object({
  v: z.literal(1),
  type: FactType,
  sources: z.array(Vendor).min(1),
  convHash: ShortHash,
  at: z.iso.date(),
  confidence: Confidence,
  quoteHash: ShortHash,
  supersedes: MemoryRef.nullable(),
  status: z.enum(['active', 'hidden']),
});
export type FerryHeader = z.infer<typeof FerryHeader>;

/** A memory as Ferry knows it locally, mirrored from Walrus Memory. */
export const StoredMemory = z.object({
  ref: MemoryRef,
  namespace: Namespace,
  text: z.string().max(MAX_FACT_CHARS),
  header: FerryHeader,
  status: MemoryStatus,
  receipts: z.array(Receipt),
  writtenAt: IsoDate,
  supersededBy: MemoryRef.nullable(),
});
export type StoredMemory = z.infer<typeof StoredMemory>;

export const ConflictVerdict = z.enum(['same', 'refines', 'contradicts', 'unrelated']);
export type ConflictVerdict = z.infer<typeof ConflictVerdict>;

export const ConflictResolution = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('keep_new'), supersede: MemoryRef }),
  z.object({ kind: z.literal('keep_old') }),
  z.object({ kind: z.literal('merge'), text: z.string().min(1).max(MAX_FACT_CHARS), supersede: MemoryRef }),
  z.object({ kind: z.literal('keep_both'), context: z.string().max(120) }),
]);
export type ConflictResolution = z.infer<typeof ConflictResolution>;
