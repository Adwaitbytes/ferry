import { describe, expect, it } from 'vitest';
import type { CandidateFact, Receipt } from '@ferry/core';
import { dedupeFacts, similarity } from './similarity.js';

function receipt(vendor: Receipt['vendor'], quoteHash: string, confidence: number, messageAt: string): Receipt {
  return { vendor, conversationIdHash: 'AbCdEfGh12345678', messageAt, quote: 'q', quoteHash, confidence };
}

let n = 0;
function candidate(text: string, over: Partial<CandidateFact> = {}): CandidateFact {
  n++;
  return {
    id: `6f1c1f1e-8a6c-4b6a-9d55-0d6a2f4b9b${String(n).padStart(2, '0')}`,
    text,
    type: 'constraint',
    receipts: [receipt('chatgpt', `QqQqQqQq${n}`, 0.8, '2026-03-01T00:00:00Z')],
    sensitive: [],
    flags: [],
    ...over,
  };
}

describe('similarity', () => {
  it('scores identical, reworded, and unrelated text', () => {
    expect(similarity('Allergic to cashews.', 'allergic to cashews')).toBe(1);
    expect(similarity('Allergic to cashews.', "I'm allergic to cashews")).toBeGreaterThan(0.6);
    expect(similarity('Allergic to cashews.', 'Lives in Pune.')).toBeLessThan(0.2);
    expect(similarity('', '')).toBe(1);
  });
});

describe('dedupeFacts', () => {
  it('merges the same fact heard in ChatGPT and Claude and keeps both receipts', () => {
    const a = candidate('Allergic to cashews.');
    const b = candidate("I'm allergic to cashews", {
      receipts: [receipt('claude', 'ClClClCl01', 0.95, '2026-01-01T00:00:00Z')],
      sensitive: ['health'],
      flags: ['llm_classifier'],
    });
    const dup = candidate('Allergic to cashews.', { receipts: a.receipts });
    const out = dedupeFacts([a, b, dup, candidate('Lives in Pune.')]);
    expect(out).toHaveLength(2);
    const merged = out[0] as CandidateFact;
    expect(merged.text).toBe("I'm allergic to cashews");
    expect(merged.receipts.map((r) => r.vendor)).toEqual(['claude', 'chatgpt']);
    expect(merged.sensitive).toEqual(['health']);
    expect(merged.flags).toEqual(['llm_classifier']);
  });

  it('never merges opposite polarity or different types', () => {
    expect(dedupeFacts([candidate('Eats fish.'), candidate('Does not eat fish.')])).toHaveLength(2);
    expect(dedupeFacts([candidate('Likes cats.', { type: 'preference' }), candidate('Likes cats.', { type: 'identity' })])).toHaveLength(2);
  });
});
