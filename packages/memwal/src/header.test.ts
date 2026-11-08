import { decodeMemory, encodeMemory } from '@ferry/core';
import { describe, expect, it } from 'vitest';
import { batchIdempotencyKey, buildHeader, chunk, isoDateOf, mergeReceipts, sha256Hex } from './header.js';
import { receipt } from './test/fakes.js';

describe('buildHeader', () => {
  it('builds sources, date, confidence and hashes from merged receipts', () => {
    const a = receipt('chatgpt', '2026-03-01T23:30:00-05:00', 0.7);
    const b = receipt('claude', '2026-10-12T09:00:00Z', 0.934);
    const c = receipt('chatgpt', '2026-04-01T09:00:00Z', 0.5);
    const header = buildHeader({ type: 'preference', receipts: [a, b, c] });
    expect(header).toEqual({
      v: 1,
      type: 'preference',
      sources: ['chatgpt', 'claude'],
      convHash: a.conversationIdHash,
      at: '2026-03-02',
      confidence: 0.93,
      quoteHash: a.quoteHash,
      supersedes: null,
      status: 'active',
    });
  });

  it('round trips through the core codec, including supersede and hidden', () => {
    const header = buildHeader({ type: 'dislike', receipts: [receipt('gemini')] }, 'blob_old-1', 'hidden');
    const decoded = decodeMemory(encodeMemory('Hates cilantro', header).memoryText);
    expect(decoded.ok && decoded.header).toEqual(header);
  });

  it('rejects a fact without receipts and invalid dates', () => {
    expect(() => buildHeader({ type: 'goal', receipts: [] })).toThrow(/receipt/);
    expect(() => isoDateOf('not a date')).toThrow(RangeError);
  });
});

describe('mergeReceipts', () => {
  it('dedupes the same quote in the same conversation, keeping the higher confidence', () => {
    const a = receipt('chatgpt');
    const better = { ...a, confidence: 0.99 };
    const other = receipt('claude');
    expect(mergeReceipts([a], [better, other])).toEqual([better, other]);
    expect(mergeReceipts([better], [a])).toEqual([better]);
  });
});

describe('batching and idempotency', () => {
  it('chunks into groups of at most n', () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    expect(chunk(items, 20).map((c) => c.length)).toEqual([20, 20, 5]);
    expect(chunk([], 20)).toEqual([]);
    expect(() => chunk(items, 0)).toThrow(RangeError);
  });

  it('derives a stable key that depends on namespace, content and order', async () => {
    const k1 = await batchIdempotencyKey('ferry-core', ['a', 'b']);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(await batchIdempotencyKey('ferry-core', ['a', 'b'])).toBe(k1);
    expect(await batchIdempotencyKey('ferry-core', ['b', 'a'])).not.toBe(k1);
    expect(await batchIdempotencyKey('ferry-events', ['a', 'b'])).not.toBe(k1);
    expect(await batchIdempotencyKey('ferry-core', ['a\u0000b'])).not.toBe(await batchIdempotencyKey('ferry-core', ['a', '', 'b']));
  });

  it('sha256Hex matches the known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('FerryDb', () => {
  it('names one database per account and accepts injected IndexedDB', async () => {
    const { FerryDb, dbNameForAccount } = await import('./db.js');
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb');
    expect(dbNameForAccount('0xABC')).toBe('ferry-memory-0xabc');
    const db = new FerryDb('injected', { indexedDB: new IDBFactory(), IDBKeyRange });
    await db.kv.put({ key: 'k', value: 1 });
    expect((await db.kv.get('k'))?.value).toBe(1);
    db.close();
  });
});
