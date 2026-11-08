import { SENSITIVE_CATEGORIES, type CandidateFact, type InjectionFlag, type Receipt } from '@ferry/core';
import { normalizeUncapped } from './unicode.js';

/** Calibrated so rewordings merge ("Allergic to cashews." / "I'm allergic to cashews") but siblings do not. */
export const DEDUPE_THRESHOLD = 0.6;

const STOPWORDS = new Set(['a', 'an', 'the', 'i', 'im', 'm', 'am', 'is', 'are', 'my', 'me', 'user', 'users', 's', 'to', 'of', 'and', 'in', 'on', 'for', 'with', 'at', 'be', 'has', 'have']);
const NEGATION = /\b(?:not|no|never|don'?t|doesn'?t|isn'?t|aren'?t|can'?t|cannot|won'?t|without|dislikes?|hates?|avoids?|stopped|quit|no longer)\b/;

interface Features {
  tokens: Set<string>;
  trigrams: Set<string>;
  negated: boolean;
}

function features(text: string): Features {
  const lower = normalizeUncapped(text).toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const words = lower.split(/[^\p{L}\p{N}']+/u).map((w) => w.replace(/'/g, '')).filter(Boolean);
  const tokens = new Set(words.filter((w) => !STOPWORDS.has(w)));
  const compact = ` ${words.join(' ')} `;
  const trigrams = new Set<string>();
  for (let i = 0; i + 3 <= compact.length; i++) trigrams.add(compact.slice(i, i + 3));
  return { tokens, trigrams, negated: NEGATION.test(lower) };
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function score(a: Features, b: Features): number {
  return (jaccard(a.tokens, b.tokens) + jaccard(a.trigrams, b.trigrams)) / 2;
}

/** Mean of content-token Jaccard and character-trigram Jaccard over normalized lowercase text, in [0, 1]. */
export function similarity(a: string, b: string): number {
  return score(features(a), features(b));
}

function receiptKey(r: Receipt): string {
  return `${r.vendor}|${r.conversationIdHash}|${r.quoteHash}`;
}

function maxConfidence(f: CandidateFact): number {
  return Math.max(...f.receipts.map((r) => r.confidence));
}

function mergeCluster(cluster: readonly CandidateFact[]): CandidateFact {
  const best = cluster.reduce((a, b) => (maxConfidence(b) > maxConfidence(a) ? b : a));
  const receipts = new Map<string, Receipt>();
  for (const f of cluster) for (const r of f.receipts) if (!receipts.has(receiptKey(r))) receipts.set(receiptKey(r), r);
  const flags = new Set<InjectionFlag>(cluster.flatMap((f) => f.flags));
  return {
    ...best,
    receipts: [...receipts.values()].sort((x, y) => x.messageAt.localeCompare(y.messageAt)),
    sensitive: SENSITIVE_CATEGORIES.filter((c) => cluster.some((f) => f.sensitive.includes(c))),
    flags: [...flags],
  };
}

/**
 * Merges near-duplicate facts of the same type and polarity, so one fact heard in ChatGPT and
 * Claude becomes one card with both receipts. The highest-confidence wording wins; flags and
 * sensitive categories are unioned so merging can never launder a quarantined fact.
 */
export function dedupeFacts(facts: readonly CandidateFact[], threshold: number = DEDUPE_THRESHOLD): CandidateFact[] {
  const clusters: { head: Features; type: CandidateFact['type']; members: CandidateFact[] }[] = [];
  for (const fact of facts) {
    const f = features(fact.text);
    const home = clusters.find((c) => c.type === fact.type && c.head.negated === f.negated && score(c.head, f) >= threshold);
    if (home) home.members.push(fact);
    else clusters.push({ head: f, type: fact.type, members: [fact] });
  }
  return clusters.map((c) => mergeCluster(c.members));
}
