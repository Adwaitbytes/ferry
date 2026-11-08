import {
  ALWAYS_BLOCKED,
  CandidateFact,
  DistillResponse,
  MAX_DISTILL_CHUNKS,
  hashShort,
  type DistilledFact,
  type FactType,
} from '@ferry/core';
import { dedupeFacts } from '@ferry/distill';
import { indexSources, locateQuote, type ImportError, type ImportResult, type ImportVendor } from '@ferry/importers';

export type SourceKind = ImportVendor;

/** Size ceilings shown to the user before any work starts. The importer enforces its own too. */
export const MAX_ZIP_BYTES = 512 * 1024 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const VENDOR_FILE: Record<Exclude<SourceKind, 'paste'>, string> = {
  chatgpt: 'ChatGPT export',
  claude: 'Claude export',
  gemini: 'Gemini Takeout',
};

/** Plain-language message for each importer failure: what happened and what to do. */
export function describeImportError(error: ImportError, source: SourceKind): string {
  const name = source === 'paste' ? 'pasted text' : VENDOR_FILE[source];
  switch (error.kind) {
    case 'archive_too_large':
      return `This file is ${formatBytes(error.actual)}. Ferry reads up to ${formatBytes(error.limit)} per import. Split the export and import each part.`;
    case 'not_a_zip':
      return `This is not a ZIP file. Pick the ${name} ZIP exactly as you downloaded it.`;
    case 'corrupt_zip':
      return 'This ZIP is damaged. Download the export again and retry.';
    case 'too_many_entries':
    case 'total_too_large':
    case 'entry_too_large':
    case 'zip_bomb':
      return 'This ZIP is larger inside than Ferry reads safely on this device. Split the export and import each part.';
    case 'unsafe_entry_name':
    case 'unsupported_entry':
      return 'This ZIP has files Ferry will not open. Download a fresh export from the vendor.';
    case 'unrecognized_export':
      return source === 'chatgpt'
        ? 'This ZIP has no conversations.json. Make sure you picked the ChatGPT export, not a single file inside it.'
        : source === 'gemini'
          ? 'This is not a Gemini Apps activity file. In Google Takeout, choose My Activity, Gemini Apps, and the JSON format.'
          : `Ferry could not find conversations in this ${name}. Make sure you picked the full export.`;
    case 'malformed_json':
    case 'invalid_shape':
      return `${error.file} is not in the format Ferry expects. Download a fresh ${name} and retry.`;
    case 'paste_too_large':
      return `This paste is ${error.actual.toLocaleString('en-US')} characters. Ferry reads up to ${error.limit.toLocaleString('en-US')} at once. Paste a shorter part.`;
    case 'empty_input':
      return 'There is nothing to read here. Paste what an assistant says it knows about you.';
    case 'aborted':
      return 'Import cancelled.';
    case 'worker_failed':
      return 'The importer on this device stopped unexpectedly. Reload the page and try again.';
  }
}

/* ---------------------------------------------------------------- */
/* Distill                                                           */
/* ---------------------------------------------------------------- */

export class DistillHttpError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = 'DistillHttpError';
    this.retryAfterMs = retryAfterMs;
  }
}

type DistillChunk = ImportResult['chunks'][number];

export async function distillBatch(chunks: readonly DistillChunk[], signal: AbortSignal): Promise<DistilledFact[]> {
  let response: Response;
  try {
    response = await fetch('/api/distill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chunks }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new DistillHttpError('the Distill service could not be reached', null);
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    throw new DistillHttpError('the Distill service is busy', Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10_000);
  }
  if (response.status === 503) throw new DistillHttpError('the Distill service has no model available right now', null);
  if (!response.ok) throw new DistillHttpError(`the Distill service returned ${response.status}`, null);
  const parsed = DistillResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new DistillHttpError('the Distill service sent a response Ferry cannot read', null);
  return parsed.data.facts;
}

export function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += MAX_DISTILL_CHUNKS) out.push(items.slice(i, i + MAX_DISTILL_CHUNKS));
  return out;
}

/* ---------------------------------------------------------------- */
/* Candidates                                                        */
/* ---------------------------------------------------------------- */

export type FactGroup = 'normal' | 'sensitive' | 'blocked' | 'quarantine';

export interface ReviewFact {
  fact: CandidateFact;
  group: FactGroup;
}

/**
 * Turns distilled facts into receipted candidates, merges near-duplicates across chunks and
 * sources, then sorts each into the group the review screen shows. Runs on this device; the raw
 * conversation ids stay local (the receipt carries only their hash).
 */
export async function buildCandidates(result: ImportResult, facts: readonly DistilledFact[]): Promise<ReviewFact[]> {
  const chunks = new Map(result.chunks.map((c) => [c.chunkId, c]));
  const sources = indexSources(result.sources);
  const candidates: CandidateFact[] = [];
  for (const fact of facts) {
    const chunk = chunks.get(fact.chunkId);
    if (!chunk) continue;
    const source = sources.get(fact.chunkId);
    const parsed = CandidateFact.safeParse({
      id: crypto.randomUUID(),
      text: fact.text,
      type: fact.type,
      receipts: [
        {
          vendor: chunk.vendor,
          conversationIdHash: chunk.conversationIdHash,
          ...(source?.conversationUrl ? { conversationUrl: source.conversationUrl } : {}),
          messageAt: source ? locateQuote(source, fact.quote) : chunk.messageAt,
          quote: fact.quote,
          quoteHash: await hashShort(fact.quote),
          confidence: fact.confidence,
        },
      ],
      sensitive: fact.sensitive,
      flags: fact.injectionSuspect ? ['llm_classifier'] : [],
    });
    if (parsed.success) candidates.push(parsed.data);
  }
  return dedupeFacts(candidates).map((fact) => ({
    fact,
    group:
      fact.flags.length > 0
        ? 'quarantine'
        : fact.sensitive.some((c) => ALWAYS_BLOCKED.includes(c))
          ? 'blocked'
          : fact.sensitive.length > 0
            ? 'sensitive'
            : 'normal',
  }));
}

export function countByType(facts: readonly ReviewFact[]): Map<FactType, number> {
  const counts = new Map<FactType, number>();
  for (const f of facts) counts.set(f.fact.type, (counts.get(f.fact.type) ?? 0) + 1);
  return counts;
}

export const SENSITIVE_LABEL: Record<string, string> = {
  health: 'Health detail',
  finance: 'Money detail',
  government_id: 'Government id',
  password: 'Password',
  card_number: 'Card number',
  secret_key: 'Secret key',
  precise_location: 'Precise location',
  sexuality: 'Sexuality',
  religion: 'Religion',
  politics: 'Politics',
};
