import type { ImportProgress, LibraryItem, StoredMemory } from '@ferry/core';
import { describe, expect, it, vi } from 'vitest';
import type { ImportQueuePort } from '../src/worker/ports';
import { PAGE_SIZE, SplitPort, SplitQueuePort, type PartPort } from '../src/worker/split-engine';
import { fakeEngine, suggestion } from './helpers';

function item(ref: string, writtenAt: string): LibraryItem {
  const memory = { ref, writtenAt } as StoredMemory;
  return { memory, endEpoch: null, blobId: ref };
}

type FakePart = PartPort & ReturnType<typeof fakeEngine>;

function part(refs: LibraryItem[], conflicts: string[] = []): FakePart {
  const engine = fakeEngine([]);
  return Object.assign(engine, {
    owns: vi.fn(async (ref: string) => refs.some((i) => i.memory.ref === ref)),
    ownsConflict: vi.fn(async (id: string) => conflicts.includes(id)),
    items: vi.fn(async (_f: unknown, limit: number) => refs.slice(0, limit)),
    exportAll: vi.fn(async () => refs.map((i) => i.memory)),
  });
}

describe('SplitPort (Vault mode)', () => {
  it('writes new facts to Vault only', async () => {
    const standard = part([]);
    const vault = part([]);
    const split = new SplitPort(standard, vault);
    const fact = { id: 'f1' } as Parameters<SplitPort['saveFact']>[0];
    await split.saveFact(fact);
    expect(vault.saveFact).toHaveBeenCalledWith(fact);
    expect(standard.saveFact).not.toHaveBeenCalled();
  });

  it('recalls from both, best score first, and survives one side failing', async () => {
    const standard = part([]);
    const vault = part([]);
    standard.recallForDraft.mockResolvedValue([
      { ...suggestion('blob-std00001', 'Vegetarian'), score: 0.5 },
    ]);
    vault.recallForDraft.mockResolvedValue([
      { ...suggestion('blob-vlt00001', 'Cashews'), score: 0.8 },
    ]);
    const split = new SplitPort(standard, vault);
    expect((await split.recallForDraft('dinner', 5)).map((s) => s.ref)).toEqual([
      'blob-vlt00001',
      'blob-std00001',
    ]);
    expect((await split.recallForDraft('dinner', 1)).map((s) => s.ref)).toEqual(['blob-vlt00001']);

    vault.recallForDraft.mockRejectedValue(new Error('embedding provider down'));
    expect((await split.recallForDraft('dinner', 5)).map((s) => s.ref)).toEqual(['blob-std00001']);
    standard.recallForDraft.mockRejectedValue(new Error('relayer down'));
    await expect(split.recallForDraft('dinner', 5)).rejects.toThrow('relayer down');
  });

  it('pages the Library across both modes, newest first', async () => {
    const standard = part(
      Array.from({ length: 40 }, (_, i) =>
        item(
          `blob-std${String(i).padStart(5, '0')}`,
          `2026-10-${String(30 - (i % 28)).padStart(2, '0')}`,
        ),
      ),
    );
    const vault = part(
      Array.from({ length: 30 }, (_, i) =>
        item(`blob-vlt${String(i).padStart(5, '0')}`, '2026-11-08'),
      ),
    );
    const split = new SplitPort(standard, vault);
    const first = await split.list({});
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.items.slice(0, 30).every((i) => i.memory.ref.startsWith('blob-vlt'))).toBe(true);
    expect(first.nextCursor).toBe(String(PAGE_SIZE));
    const second = await split.list({ cursor: first.nextCursor ?? '' });
    expect(second.items).toHaveLength(20);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((i) => i.memory.ref);
    expect(new Set(all).size).toBe(70);
  });

  it('interleaves search hits so both modes reach the first page', async () => {
    const split = new SplitPort(
      part([item('blob-std00001', '2026-10-01'), item('blob-std00002', '2026-10-01')]),
      part([item('blob-vlt00001', '2026-11-01')]),
    );
    const page = await split.list({ query: 'food' });
    expect(page.items.map((i) => i.memory.ref)).toEqual([
      'blob-std00001',
      'blob-vlt00001',
      'blob-std00002',
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('hides and resolves in whichever mode holds the memory', async () => {
    const standard = part([item('blob-std00001', '2026-10-01')], ['c-std']);
    const vault = part([item('blob-vlt00001', '2026-11-01')], ['c-vlt']);
    const split = new SplitPort(standard, vault);
    await split.hide('blob-vlt00001');
    await split.hide('blob-std00001');
    expect(vault.hide).toHaveBeenCalledWith('blob-vlt00001');
    expect(standard.hide).toHaveBeenCalledWith('blob-std00001');
    await split.resolveConflict('c-vlt', { kind: 'keep_old' });
    await split.resolveConflict('c-std', { kind: 'keep_old' });
    expect(vault.resolveConflict).toHaveBeenCalledWith('c-vlt', { kind: 'keep_old' });
    expect(standard.resolveConflict).toHaveBeenCalledWith('c-std', { kind: 'keep_old' });
  });

  it('exports both modes and destroys both engines', async () => {
    const standard = part([item('blob-std00001', '2026-10-01')]);
    const vault = part([item('blob-vlt00001', '2026-11-01')]);
    const split = new SplitPort(standard, vault);
    expect((await split.exportAll()).map((m) => m.ref)).toEqual(['blob-std00001', 'blob-vlt00001']);
    expect(split.governor()).toEqual({ kind: 'ready' });
    split.destroy();
    expect(standard.destroyed && vault.destroyed).toBe(true);
  });
});

function queue(
  state: ImportProgress['state'],
): ImportQueuePort & { listeners: Set<(p: ImportProgress) => void>; enqueued: number } {
  const listeners = new Set<(p: ImportProgress) => void>();
  const q = {
    listeners,
    enqueued: 0,
    state,
    enqueue: async (facts: readonly unknown[]) => {
      q.enqueued += facts.length;
      return { queued: facts.length };
    },
    progress: (): ImportProgress => ({ total: 4, written: 1, failed: 0, state: q.state }),
    subscribe: (l: (p: ImportProgress) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return q;
}

describe('SplitQueuePort', () => {
  it('drains Standard imports first, then reports and takes new work in Vault', async () => {
    const standard = queue('writing');
    const vault = queue('idle');
    const split = new SplitQueuePort(standard, vault);
    await split.enqueue([{} as never]);
    expect(vault.enqueued).toBe(1);
    expect(standard.enqueued).toBe(0);
    expect(split.progress().state).toBe('writing');
    (standard as unknown as { state: string }).state = 'done';
    expect(split.progress().state).toBe('idle');

    const seen: string[] = [];
    const stop = split.subscribe((p) => seen.push(p.state));
    for (const l of vault.listeners) l(vault.progress());
    expect(seen).toEqual(['idle']);
    stop();
    expect(standard.listeners.size + vault.listeners.size).toBe(0);
  });
});
