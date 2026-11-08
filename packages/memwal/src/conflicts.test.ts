import type { ConflictVerdict } from '@ferry/core';
import { describe, expect, it, vi } from 'vitest';
import { FerryMemory } from './memory.js';
import { ACCOUNT, FakeRelayer, SEED, TestClock, fact, freshDb, receipt } from './test/fakes.js';
import type { ConflictJudge } from './types.js';

async function withExisting(text = 'Vegetarian diet always') {
  const clock = new TestClock();
  const relayer = new FakeRelayer(clock);
  const memory = new FerryMemory({ seed: SEED, accountId: ACCOUNT, serverUrl: 'https://relayer.memory.walrus.xyz', clock, client: relayer, db: freshDb() });
  const [r] = await memory.writeFacts([fact({ text, vendor: 'chatgpt', messageAt: '2026-03-01T10:00:00Z' })]);
  if (r?.status !== 'written') throw new Error('write failed');
  return { memory, relayer, existing: r.ref };
}

const judgeAll = (verdict: ConflictVerdict): ConflictJudge =>
  vi.fn<ConflictJudge>(async (req) => ({ verdicts: req.neighbors.map((n) => ({ ref: n.ref, verdict, reason: `judged ${verdict}` })) }));

describe('findNeighbors', () => {
  it('returns close, same-type, in-force memories only', async () => {
    const { memory, existing } = await withExisting();
    await memory.writeFacts([fact({ text: 'Vegetarian diet goal', type: 'goal' })]);
    const n = await memory.findNeighbors({ text: 'Vegetarian diet', type: 'preference' });
    expect(n.map((x) => x.ref)).toEqual([existing]);
    expect(await memory.findNeighbors({ text: '​', type: 'preference' })).toEqual([]);
    await memory.hide(existing);
    expect(await memory.findNeighbors({ text: 'Vegetarian diet', type: 'preference' })).toEqual([]);
  });
});

describe('reconcile', () => {
  it('writes directly when there are no neighbors, or the judge says unrelated', async () => {
    const { memory } = await withExisting();
    const judge = judgeAll('unrelated');
    const lonely = await memory.reconcile(fact({ text: 'Collects stamps' }), judge);
    expect(lonely).toMatchObject({ kind: 'written', result: { status: 'written' } });
    expect(judge).not.toHaveBeenCalled();
    const near = await memory.reconcile(fact({ text: 'Vegetarian diet since school' }), judge);
    expect(near.kind).toBe('written');
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('merges receipts for `same` without writing', async () => {
    const { memory, relayer, existing } = await withExisting();
    const writes = relayer.calls.remember + relayer.calls.bulk;
    const dup = fact({ text: 'Vegetarian diet', receipts: [receipt('claude')] });
    const out = await memory.reconcile(dup, judgeAll('same'));
    expect(out).toEqual({ kind: 'merged', ref: existing });
    expect(relayer.calls.remember + relayer.calls.bulk).toBe(writes);
    expect((await memory.index.receiptsFor(existing)).map((r) => r.vendor).sort()).toEqual(['chatgpt', 'claude']);
    expect((await memory.index.get(existing))?.sources).toEqual(['chatgpt', 'claude']);
  });

  it('ignores verdicts about refs that were not offered', async () => {
    const { memory } = await withExisting();
    const rogue: ConflictJudge = async () => ({ verdicts: [{ ref: 'blob_not_offered', verdict: 'contradicts', reason: 'x' }] });
    expect((await memory.reconcile(fact({ text: 'Vegetarian diet maybe' }), rogue)).kind).toBe('written');
  });
});

describe('conflict resolution', () => {
  it('contradicts then keep_new supersedes the old memory', async () => {
    const { memory, existing } = await withExisting();
    const newFact = fact({ text: 'Vegetarian diet ended, eats fish', vendor: 'claude' });
    const out = await memory.reconcile(newFact, judgeAll('contradicts'));
    if (out.kind !== 'conflict') throw new Error('expected conflict');
    expect(out.verdict).toBe('contradicts');
    expect((await memory.index.get(existing))?.status).toBe('conflict');
    expect(await memory.openConflicts()).toHaveLength(1);
    expect(await memory.recallForDraft('vegetarian diet', 5)).toEqual([]);

    const results = await memory.resolveConflict(out.conflictId, { kind: 'keep_new', supersede: existing });
    const [r] = results;
    if (r?.status !== 'written') throw new Error('expected written');
    expect((await memory.index.get(existing))).toMatchObject({ status: 'superseded', supersededBy: r.ref });
    expect((await memory.index.get(r.ref))?.header?.supersedes).toBe(existing);
    expect(await memory.openConflicts()).toEqual([]);
    await expect(memory.resolveConflict(out.conflictId, { kind: 'keep_old' })).rejects.toThrow(/no open conflict/);
  });

  it('keep_old discards the new fact and restores the old one', async () => {
    const { memory, relayer, existing } = await withExisting();
    const out = await memory.reconcile(fact({ text: 'Vegetarian diet no more' }), judgeAll('contradicts'));
    if (out.kind !== 'conflict') throw new Error('expected conflict');
    const writes = relayer.calls.remember + relayer.calls.bulk;
    expect(await memory.resolveConflict(out.conflictId, { kind: 'keep_old' })).toEqual([]);
    expect(relayer.calls.remember + relayer.calls.bulk).toBe(writes);
    expect((await memory.index.get(existing))?.status).toBe('active');
  });

  it('merge writes the merged text with both receipts and supersedes', async () => {
    const { memory, existing } = await withExisting();
    const out = await memory.reconcile(fact({ text: 'Vegetarian diet except sushi', vendor: 'gemini' }), judgeAll('contradicts'));
    if (out.kind !== 'conflict') throw new Error('expected conflict');
    await expect(memory.resolveConflict(out.conflictId, { kind: 'merge', text: 'x', supersede: 'blob_wrong' })).rejects.toThrow(/supersede/);
    const [r] = await memory.resolveConflict(out.conflictId, { kind: 'merge', text: 'Mostly vegetarian, eats sushi', supersede: existing });
    if (r?.status !== 'written') throw new Error('expected written');
    const merged = await memory.index.get(r.ref);
    expect(merged).toMatchObject({ factText: 'Mostly vegetarian, eats sushi', sources: ['gemini', 'chatgpt'] });
    expect(await memory.index.receiptsFor(r.ref)).toHaveLength(2);
    expect((await memory.index.get(existing))?.status).toBe('superseded');
  });

  it('keep_both writes the new fact with context and leaves both active', async () => {
    const { memory, existing } = await withExisting();
    const out = await memory.reconcile(fact({ text: 'Vegetarian diet paused' }), judgeAll('contradicts'));
    if (out.kind !== 'conflict') throw new Error('expected conflict');
    const [r] = await memory.resolveConflict(out.conflictId, { kind: 'keep_both', context: 'while travelling' });
    if (r?.status !== 'written') throw new Error('expected written');
    expect((await memory.index.get(r.ref))?.factText).toBe('Vegetarian diet paused (while travelling)');
    expect((await memory.index.get(existing))?.status).toBe('active');
    expect((await memory.index.get(r.ref))?.status).toBe('active');

    const again = await memory.reconcile(fact({ text: 'Vegetarian diet resumed' }), async (req) => ({
      verdicts: req.neighbors.map((n) => ({ ref: n.ref, verdict: 'contradicts' as const, reason: 'x' })),
    }));
    if (again.kind !== 'conflict') throw new Error('expected conflict');
    const [plain] = await memory.resolveConflict(again.conflictId, { kind: 'keep_both', context: '' });
    if (plain?.status !== 'written') throw new Error('expected written');
    expect((await memory.index.get(plain.ref))?.factText).toBe('Vegetarian diet resumed');
  });

  it('refines becomes a supersede candidate that keep_new applies', async () => {
    const { memory, existing } = await withExisting();
    const out = await memory.reconcile(fact({ text: 'Vegetarian diet, no eggs either' }), judgeAll('refines'));
    if (out.kind !== 'conflict') throw new Error('expected conflict');
    expect(out.verdict).toBe('refines');
    expect((await memory.index.get(existing))?.status).toBe('active');
    await memory.resolveConflict(out.conflictId, { kind: 'keep_new', supersede: existing });
    expect((await memory.index.get(existing))?.status).toBe('superseded');
  });

  it('throws when a resolution write is blocked', async () => {
    const { memory, existing } = await withExisting();
    const blocked = fact({ text: 'Vegetarian diet card', sensitive: ['card_number'] });
    const out = await memory.reconcile(blocked, judgeAll('contradicts'));
    if (out.kind !== 'conflict') throw new Error('expected conflict');
    await expect(memory.resolveConflict(out.conflictId, { kind: 'keep_new', supersede: existing })).rejects.toThrow(/blocked/);
  });
});
