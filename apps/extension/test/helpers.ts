import type {
  AccountView,
  CandidateFact,
  DistilledFact,
  ImportProgress,
  StoredMemory,
  Suggestion,
} from '@ferry/core';
import { vi } from 'vitest';
import type {
  EngineFactory,
  FerryApi,
  ImportQueuePort,
  MemoryPort,
  StorageArea,
  VaultCrypto,
  WriteOutcome,
} from '../src/worker/ports';
import { FerryWorker, type WorkerDeps } from '../src/worker/service';

export const EXT_ID = 'ferrytestextensionidaaaaaaaaaaaa';
export const FERRY_WEB_ORIGIN = 'https://ferry.example';
export const ACCOUNT_ID = `0x${'1'.repeat(64)}`;
export const PUBLIC_KEY = 'ab'.repeat(32);
export const PASSPHRASE = 'correct horse battery staple';

export const panelSender = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/sidepanel.html` };
export const contentSender = (site: 'chatgpt' | 'claude' | 'gemini' = 'claude', tabId = 4) => {
  const url = {
    chatgpt: 'https://chatgpt.com/c/1',
    claude: 'https://claude.ai/new',
    gemini: 'https://gemini.google.com/app',
  }[site];
  return { id: EXT_ID, url, origin: new URL(url).origin, tab: { id: tabId, url }, frameId: 0 };
};
export const webSender = { origin: FERRY_WEB_ORIGIN, url: `${FERRY_WEB_ORIGIN}/pair` };

export function memArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => structuredClone(data.get(k)),
    set: async (k, v) => void data.set(k, structuredClone(v)),
    remove: async (k) => void data.delete(k),
    clear: async () => data.clear(),
  };
}

/** Deterministic stand-in for memwal sealSeed/openSeed. The real one is exercised in RT-78. */
export const fakeCrypto: VaultCrypto = {
  generateSeed: () => new Uint8Array(32).fill(7),
  sealSeed: async (seed, passphrase) => ({ pass: passphrase, seed: Array.from(seed) }),
  openSeed: async (sealed, passphrase) => {
    const s = sealed as { pass: string; seed: number[] };
    if (s.pass !== passphrase) throw new Error('wrong passphrase');
    return new Uint8Array(s.seed);
  },
  publicKeyHex: async () => PUBLIC_KEY,
  suiAddress: async () => `0x${'cd'.repeat(32)}`,
};

export function suggestion(ref: string, text: string): Suggestion {
  return { ref, text, type: 'preference', sources: ['chatgpt'], heardAt: '2026-10-12', score: 0.9 };
}

export interface FakeEngine extends MemoryPort {
  recallForDraft: ReturnType<typeof vi.fn<(draft: string, k: number) => Promise<Suggestion[]>>>;
  saveFact: ReturnType<typeof vi.fn<(fact: CandidateFact) => Promise<WriteOutcome>>>;
  hide: ReturnType<typeof vi.fn<(ref: string) => Promise<void>>>;
  destroyed: boolean;
}

export function fakeEngine(
  suggestions: Suggestion[] = [
    suggestion('blob-aaaaaaaa1', 'Vegetarian'),
    suggestion('blob-aaaaaaaa2', 'Allergic to cashews'),
  ],
): FakeEngine {
  const engine: FakeEngine = {
    destroyed: false,
    recallForDraft: vi.fn(async () => suggestions),
    saveFact: vi.fn(async () => ({ kind: 'written', ref: 'blob-new000001' }) as WriteOutcome),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    hide: vi.fn(async () => undefined),
    resolveConflict: vi.fn(async () => undefined),
    exportAll: vi.fn(async (): Promise<StoredMemory[]> => []),
    destroy() {
      engine.destroyed = true;
    },
  };
  return engine;
}

export function fakeImports(): ImportQueuePort & { enqueued: CandidateFact[] } {
  const enqueued: CandidateFact[] = [];
  const progress: ImportProgress = { total: 0, written: 0, failed: 0, state: 'idle' };
  return {
    enqueued,
    enqueue: async (facts) => {
      enqueued.push(...facts);
      return { queued: facts.length };
    },
    progress: () => progress,
    subscribe: () => () => undefined,
  };
}

export function accountView(overrides: Partial<AccountView> = {}): AccountView {
  return {
    accountId: ACCOUNT_ID,
    owner: `0x${'2'.repeat(64)}`,
    active: true,
    delegates: [
      {
        publicKey: PUBLIC_KEY,
        suiAddress: `0x${'cd'.repeat(32)}`,
        label: 'Ferry on Chrome',
        createdAt: null,
      },
    ],
    version: '1',
    ...overrides,
  };
}

export function fakeApi(
  overrides: Partial<FerryApi> = {},
): FerryApi & { distilled: DistilledFact[] } {
  const api: FerryApi & { distilled: DistilledFact[] } = {
    distilled: [],
    getAccount: vi.fn(async () => accountView()),
    getBlob: vi.fn(async () => ({
      blobId: 'x',
      objectId: null,
      owner: null,
      certifiedEpoch: null,
      endEpoch: null,
      currentEpoch: 1,
    })),
    distillMessage: vi.fn(async (): Promise<DistilledFact[]> => api.distilled),
    judge: vi.fn(async () => ({ verdicts: [] })),
    ...overrides,
  };
  return api;
}

export interface Harness {
  worker: FerryWorker;
  engine: FakeEngine;
  imports: ReturnType<typeof fakeImports>;
  api: ReturnType<typeof fakeApi>;
  local: ReturnType<typeof memArea>;
  session: ReturnType<typeof memArea>;
  clock: { now: () => number; t: number };
  engines: EngineFactory & { created: number };
  wiped: { count: number };
}

export function harness(overrides: Partial<WorkerDeps> = {}, engine = fakeEngine()): Harness {
  const local = memArea();
  const session = memArea();
  const imports = fakeImports();
  const api = fakeApi();
  const clock = { t: Date.parse('2026-11-09T12:00:00Z'), now: () => clock.t };
  const engines = {
    created: 0,
    async create() {
      engines.created += 1;
      engine.destroyed = false;
      return { engine, imports };
    },
  };
  const wiped = { count: 0 };
  let n = 0;
  const worker = new FerryWorker({
    extensionId: EXT_ID,
    webOrigin: FERRY_WEB_ORIGIN,
    local,
    session,
    crypto: fakeCrypto,
    api,
    engines,
    clock,
    exporter: { toJson: async (m) => JSON.stringify(m), toMarkdown: (m) => `${m.length}` },
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    openSidePanel: async () => undefined,
    wipeIndexedDb: async () => {
      wiped.count += 1;
    },
    deviceLabel: () => 'Ferry on Chrome 9 Nov 2026',
    ...overrides,
  });
  return { worker, engine, imports, api, local, session, clock, engines, wiped };
}

/** A worker that is set up, open and paired. */
export async function openPaired(h: Harness = harness()): Promise<Harness> {
  const opened = await h.worker.route(
    { type: 'unlock', passphrase: PASSPHRASE },
    panelSender,
    'internal',
  );
  if (!opened.ok) throw new Error(`open failed: ${opened.message}`);
  const paired = await h.worker.route(
    { type: 'pairing.confirm', accountId: ACCOUNT_ID },
    panelSender,
    'internal',
  );
  if (!paired.ok) throw new Error(`pair failed: ${paired.message}`);
  return h;
}
