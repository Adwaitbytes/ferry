import {
  SensitiveCategory,
  type CandidateFact,
  type GovernorStatus,
  type ImportProgress,
  type LibraryConflict,
  type LibraryItem,
  type MemoryStatus,
  type SaveResult,
} from '@ferry/core';
import {
  FerryMemory,
  ImportQueue,
  generateSeed,
  openSecret,
  openSeed,
  publicKeyHex,
  sealSecret,
  sealSeed,
  suiAddress,
  zeroize,
  type MemoryEngine,
} from '@ferry/memwal';
import { FerryVaultMemory } from '@ferry/memwal/vault';
import { RELAYER_URL } from '../lib/config';
import type { EngineFactory, FerryApi, ImportQueuePort, VaultCrypto, VaultEngineConfig } from './ports';
import { PAGE_SIZE, SplitPort, SplitQueuePort, offsetOf, type ListFilter, type PartPort } from './split-engine';

const SEARCH_LIMIT = 20;

export const memwalCrypto: VaultCrypto = {
  generateSeed,
  sealSeed: (seed, passphrase) => sealSeed(seed, passphrase),
  openSeed: (sealed, passphrase) => openSeed(sealed, passphrase),
  publicKeyHex: (seed) => publicKeyHex(seed),
  suiAddress: (seed) => suiAddress(seed),
  sealSecret: (seed, purpose, secret) => sealSecret(seed, purpose, secret),
  openSecret: (seed, purpose, sealed) => openSecret(seed, purpose, sealed),
};

/** Adapts packages/memwal to the worker's ports. The judge runs on the Ferry server (F5). */
class MemwalPort implements PartPort {
  constructor(
    private readonly memory: MemoryEngine,
    private readonly api: FerryApi,
    private readonly seed: Uint8Array,
  ) {}

  recallForDraft(draft: string, k: number) {
    return this.memory.recallForDraft(draft, k);
  }

  async saveFact(fact: CandidateFact): Promise<SaveResult> {
    const factId = fact.id;
    const outcome = await this.memory.reconcile(fact, (request) => this.api.judge(request));
    if (outcome.kind === 'conflict')
      return {
        factId,
        status: 'conflict',
        conflictId: outcome.conflictId,
        verdict: outcome.verdict,
      };
    if (outcome.kind === 'merged') return { factId, status: 'merged', ref: outcome.ref };
    const r = outcome.result;
    switch (r.status) {
      case 'written':
        return { factId, status: 'written', ref: r.ref };
      case 'pending':
        return { factId, status: 'pending' };
      case 'quarantined':
        return { factId, status: 'quarantined' };
      case 'blocked':
        return {
          factId,
          status: 'blocked',
          categories: r.categories.filter(
            (c): c is SensitiveCategory => SensitiveCategory.safeParse(c).success,
          ),
        };
      case 'failed':
        return { factId, status: 'failed' };
    }
  }

  governor(): GovernorStatus {
    return this.memory.governor.state;
  }

  /** Open conflicts keyed by the stored memory they dispute, so Library rows can carry them. */
  private async conflictsByRef(): Promise<Map<string, LibraryConflict>> {
    const byRef = new Map<string, LibraryConflict>();
    for (const c of await this.memory.openConflicts()) {
      const first = c.newFact.receipts[0];
      if (first === undefined) continue;
      byRef.set(c.existingRef, {
        conflictId: c.id,
        otherRef: c.newFact.id,
        otherText: c.newFact.text,
        otherSources: [...new Set(c.newFact.receipts.map((r) => r.vendor))],
        otherHeardAt: first.messageAt.slice(0, 10),
        verdict: c.verdict,
      });
    }
    return byRef;
  }

  async owns(ref: string): Promise<boolean> {
    return (await this.memory.index.get(ref)) !== undefined;
  }

  async ownsConflict(conflictId: string): Promise<boolean> {
    return (await this.memory.openConflicts()).some((c) => c.id === conflictId);
  }

  items(filter: Omit<ListFilter, 'cursor'>, limit: number): Promise<LibraryItem[]> {
    return this.collect(filter, 0, limit);
  }

  async list(filter: ListFilter) {
    const offset = offsetOf(filter.cursor);
    const memories = await this.collect(filter, offset, PAGE_SIZE + 1);
    const hasMore = filter.query === undefined && memories.length > PAGE_SIZE;
    return { items: memories.slice(0, PAGE_SIZE), nextCursor: hasMore ? String(offset + PAGE_SIZE) : null };
  }

  private async collect(
    filter: { status?: MemoryStatus; query?: string },
    offset: number,
    limit: number,
  ): Promise<LibraryItem[]> {
    let memories;
    if (filter.query !== undefined && filter.query.trim().length > 0) {
      const hits = await this.memory.recallForDraft(filter.query, SEARCH_LIMIT);
      const order = new Map(hits.map((h, i) => [h.ref, i]));
      const all = await this.memory.list(
        filter.status !== undefined ? { status: filter.status, limit: 5000 } : { limit: 5000 },
      );
      memories = all
        .filter((m) => order.has(m.ref))
        .sort((a, b) => (order.get(a.ref) ?? 0) - (order.get(b.ref) ?? 0));
    } else {
      memories = await this.memory.list({
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        limit,
        offset,
      });
    }
    const page = memories.slice(0, limit);
    const conflicts = page.some((m) => m.status === 'conflict')
      ? await this.conflictsByRef()
      : new Map<string, LibraryConflict>();
    const items: LibraryItem[] = [];
    for (const memory of page) {
      const record = await this.memory.index.get(memory.ref);
      const conflict = memory.status === 'conflict' ? conflicts.get(memory.ref) : undefined;
      items.push({
        memory,
        endEpoch: memory.endEpoch ?? record?.endEpoch ?? null,
        blobId: memory.ref,
        ...(conflict !== undefined ? { conflict } : {}),
      });
    }
    return items;
  }

  hide(ref: string) {
    return this.memory.hide(ref);
  }

  async resolveConflict(
    conflictId: string,
    resolution: Parameters<MemoryEngine['resolveConflict']>[1],
  ) {
    await this.memory.resolveConflict(conflictId, resolution);
  }

  exportAll() {
    return this.memory.exportAll();
  }

  destroy(): void {
    this.memory.destroy();
    zeroize(this.seed);
  }
}

class QueuePort implements ImportQueuePort {
  private last: ImportProgress = { total: 0, written: 0, failed: 0, state: 'idle' };
  private readonly listeners = new Set<(p: ImportProgress) => void>();

  constructor(private readonly queue: ImportQueue) {
    queue.subscribe((p) => {
      this.last = p;
      for (const l of this.listeners) l(p);
    });
    void queue.progress().then((p) => {
      this.last = p;
    });
    void queue.start();
  }

  async enqueue(facts: readonly CandidateFact[]) {
    const queued = await this.queue.enqueue(facts);
    void this.queue.start();
    return { queued };
  }

  progress(): ImportProgress {
    return this.last;
  }

  subscribe(listener: (p: ImportProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Wires one engine and its import queue, so locking disposes both together. */
function standardParts(
  api: FerryApi,
  seed: Uint8Array,
  accountId: string,
): { port: MemwalPort; imports: QueuePort; memory: FerryMemory } {
  // The engine owns its own copy, so locking can zero both without racing each other.
  // MemWal.create copies the key, so our copy is wiped as soon as the client exists.
  const own = new Uint8Array(seed);
  const memory = new FerryMemory({ seed: own, accountId, serverUrl: RELAYER_URL });
  zeroize(own);
  return { memory, ...withQueue(memory, new MemwalPort(memory, api, own)) };
}

function withQueue(memory: MemoryEngine, port: MemwalPort): { port: MemwalPort; imports: QueuePort } {
  const queue = new ImportQueue(memory, memory.index.db);
  const imports = new QueuePort(queue);
  const destroy = port.destroy.bind(port);
  port.destroy = () => {
    queue.dispose();
    destroy();
  };
  return { port, imports };
}

/**
 * Vault engine. The Seal session key is signed by the delegate seed (no wallet can be reached from
 * a service worker), and both engines share one governor because they spend one key's budget.
 */
async function vaultParts(
  api: FerryApi,
  seed: Uint8Array,
  accountId: string,
  standard: FerryMemory,
  vault: VaultEngineConfig,
): Promise<{ port: MemwalPort; imports: QueuePort }> {
  const own = new Uint8Array(seed);
  try {
    const memory = await FerryVaultMemory.create({
      seed: own,
      accountId,
      serverUrl: RELAYER_URL,
      embedding: vault,
      governor: standard.governor,
    });
    return withQueue(memory, new MemwalPort(memory, api, own));
  } finally {
    zeroize(own);
  }
}

export function memwalEngines(api: FerryApi): EngineFactory {
  return {
    async create({ seed, accountId, vault }) {
      const standard = standardParts(api, seed, accountId);
      if (vault === null) return { engine: standard.port, imports: standard.imports };
      try {
        const v = await vaultParts(api, seed, accountId, standard.memory, vault);
        return {
          engine: new SplitPort(standard.port, v.port),
          imports: new SplitQueuePort(standard.imports, v.imports),
        };
      } catch (error) {
        standard.port.destroy();
        throw error;
      }
    },
  };
}
