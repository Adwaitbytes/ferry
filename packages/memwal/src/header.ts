import type { CandidateFact, FerryHeader, Receipt, Vendor } from '@ferry/core';

/** ISO date (UTC) of an ISO datetime with offset. */
export function isoDateOf(datetime: string): string {
  const ms = Date.parse(datetime);
  if (Number.isNaN(ms)) throw new RangeError(`isoDateOf: invalid datetime ${datetime}`);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Unions receipts, keyed by quote hash plus conversation, so the same quote heard twice in one
 * conversation counts once while the same sentence heard in ChatGPT and Claude keeps both.
 */
export function mergeReceipts(...lists: ReadonlyArray<readonly Receipt[]>): Receipt[] {
  const seen = new Map<string, Receipt>();
  for (const list of lists) {
    for (const r of list) {
      const key = `${r.vendor}\u0000${r.conversationIdHash}\u0000${r.quoteHash}`;
      const prior = seen.get(key);
      if (!prior || r.confidence > prior.confidence) seen.set(key, r);
    }
  }
  return [...seen.values()];
}

/**
 * Builds the header from a fact's receipts. The first receipt anchors the conversation, date
 * and quote hash (it is the one the receipt drawer opens first); sources and confidence are
 * taken across all receipts so a merged fact shows every vendor it was heard in.
 */
export function buildHeader(
  fact: Pick<CandidateFact, 'type' | 'receipts'>,
  supersedes: string | null = null,
  status: FerryHeader['status'] = 'active',
): FerryHeader {
  const [first] = fact.receipts;
  if (!first) throw new Error('buildHeader: a fact needs at least one receipt');
  const sources: Vendor[] = [];
  for (const r of fact.receipts) if (!sources.includes(r.vendor)) sources.push(r.vendor);
  const confidence = Math.max(...fact.receipts.map((r) => r.confidence));
  return {
    v: 1,
    type: fact.type,
    sources,
    convHash: first.conversationIdHash,
    at: isoDateOf(first.messageAt),
    // Two decimals is what the header carries; rounding here keeps a decode round trip exact.
    confidence: Math.round(confidence * 100) / 100,
    quoteHash: first.quoteHash,
    supersedes,
    status,
  };
}

const encoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(input)));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Stable per batch content: a resumed or retried batch sends the same key, so the relayer
 * dedupes it instead of writing every memory twice. Namespace is part of the input because the
 * relayer scopes keys per (owner, namespace).
 */
export function batchIdempotencyKey(namespace: string, texts: readonly string[]): Promise<string> {
  return sha256Hex(`ferry-bulk-v1\u0000${namespace}\u0000${texts.join('\u0000')}`);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('chunk: size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
