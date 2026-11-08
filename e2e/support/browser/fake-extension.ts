/*
 * CI-only stand-in for the Ferry extension, injected into the web app with page.addInitScript.
 * It answers `chrome.runtime.sendMessage(extensionId, WebAppRequest)` in memory, validates every
 * request with the @ferry/core WebAppRequest schema, and parses every reply with the matching
 * WebAppResponse schema before sending it, exactly like the real worker. It never ships.
 */
import {
  ALWAYS_BLOCKED,
  WebAppRequest,
  WebAppResponse,
  keyFingerprint,
  type CandidateFact,
  type LibraryItem,
  type StoredMemory,
  type Suggestion,
  type WorkerError,
} from '@ferry/core';
import { toMarkdown, toPam } from '@ferry/importers';
import { STORAGE, type E2EConfig, type ExtensionLogEntry, type ExtensionSeed } from '../protocol';

declare global {
  interface Window {
    __FERRY_E2E_CONFIG__: E2EConfig;
  }
}

interface ImportJob {
  total: number;
  written: number;
  queue: CandidateFact[];
}

interface State extends ExtensionSeed {
  importJob: ImportJob | null;
}

const config = window.__FERRY_E2E_CONFIG__;

function load(): State {
  const raw = localStorage.getItem(STORAGE.extension);
  if (raw !== null) return JSON.parse(raw) as State;
  return { ...config.extension, importJob: null };
}

function save(state: State): void {
  localStorage.setItem(STORAGE.extension, JSON.stringify(state));
}

function log(entry: ExtensionLogEntry): void {
  const prior = JSON.parse(localStorage.getItem(STORAGE.extensionLog) ?? '[]') as ExtensionLogEntry[];
  localStorage.setItem(STORAGE.extensionLog, JSON.stringify([...prior, entry]));
}

class Refusal extends Error {
  constructor(
    readonly code: WorkerError['code'],
    message: string,
  ) {
    super(message);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function memoryFromCandidate(fact: CandidateFact, ref: string, text = fact.text): StoredMemory {
  const receipt = fact.receipts[0];
  const vendors = [...new Set(fact.receipts.map((r) => r.vendor))];
  return {
    ref,
    namespace: 'ferry-core',
    text,
    header: {
      v: 1,
      type: fact.type,
      sources: vendors.length > 0 ? vendors : ['manual'],
      convHash: receipt?.conversationIdHash ?? 'Q29udkhhc2gx',
      at: today(),
      confidence: receipt?.confidence ?? 0.9,
      quoteHash: receipt?.quoteHash ?? 'UXVvdGVIYXNo',
      supersedes: null,
      status: 'active',
    },
    status: 'active',
    receipts: fact.receipts,
    writtenAt: new Date().toISOString(),
    supersededBy: null,
    endEpoch: 1210,
  };
}

function item(memory: StoredMemory): LibraryItem {
  return { memory, endEpoch: memory.endEpoch ?? null, blobId: `blob_${memory.ref}` };
}

function refFor(id: string): string {
  return `mem_${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
}

function requirePaired(state: State): void {
  if (state.locked) throw new Refusal('locked', 'Ferry is locked.');
  if (!state.paired) throw new Refusal('not_paired', 'Pair this browser first.');
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
}

async function handle(request: WebAppRequest, state: State): Promise<unknown> {
  switch (request.type) {
    case 'status.get':
      return {
        lock: state.hasVault ? (state.locked ? 'locked' : 'open') : 'uninitialized',
        locked: state.locked,
        paired: state.paired,
        accountId: state.accountId,
        publicKeyHex: state.publicKeyHex,
        fingerprint: keyFingerprint(state.publicKeyHex),
        suiAddress: `0x${'d2'.repeat(32)}`,
        account:
          state.paired && state.accountId
            ? { accountId: state.accountId, owner: state.owner ?? `0x${'0a'.repeat(32)}`, pairedAt: '2026-11-09T08:00:00.000Z' }
            : null,
        autoLockMinutes: 30,
        msUntilAutoLock: state.locked ? null : 1_800_000,
        governor: { kind: 'ready' },
        importProgress: progressOf(state),
      };
    case 'pairing.begin':
      if (state.locked) throw new Refusal('locked', 'Ferry is locked.');
      return {
        publicKeyHex: state.publicKeyHex,
        suiAddress: `0x${'d2'.repeat(32)}`,
        fingerprint: keyFingerprint(state.publicKeyHex),
        label: 'Ferry on Chrome',
        accountId: state.accountId,
      };
    case 'pairing.confirm':
      if (state.locked) throw new Refusal('locked', 'Ferry is locked.');
      state.paired = true;
      state.accountId = request.accountId;
      return { accountId: request.accountId, owner: state.owner ?? `0x${'0a'.repeat(32)}` };
    case 'import.enqueue': {
      requirePaired(state);
      const accepted = request.facts.filter((f) => !f.sensitive.some((c) => ALWAYS_BLOCKED.includes(c)));
      const job = state.importJob ?? { total: 0, written: 0, queue: [] };
      const known = new Set(job.queue.map((f) => f.id));
      const fresh = accepted.filter((f) => !known.has(f.id));
      state.importJob = { total: job.total + fresh.length, written: job.written, queue: [...job.queue, ...fresh] };
      return { queued: fresh.length, dropped: request.facts.length - accepted.length };
    }
    case 'import.progress': {
      requirePaired(state);
      const job = state.importJob;
      if (job !== null && job.written < job.total) {
        const next = job.queue.slice(job.written, job.written + state.writesPerPoll);
        for (const fact of next) state.items.push(item(memoryFromCandidate(fact, refFor(fact.id))));
        job.written += next.length;
      }
      return progressOf(state);
    }
    case 'memory.list': {
      requirePaired(state);
      const query = request.query?.toLowerCase().trim();
      const items = state.items.filter(
        (i) => (request.status === undefined || i.memory.status === request.status) && (!query || i.memory.text.toLowerCase().includes(query)),
      );
      return { items, nextCursor: null };
    }
    case 'memory.recall': {
      requirePaired(state);
      const asked = words(request.query);
      const active = state.items.filter((i) => i.memory.status === 'active');
      const scored = active
        .map((i) => ({ i, score: [...words(i.memory.text)].filter((w) => asked.has(w)).length }))
        .sort((a, b) => b.score - a.score)
        .slice(0, request.limit);
      return scored.map(
        ({ i, score }): Suggestion => ({
          ref: i.memory.ref,
          text: i.memory.text,
          type: i.memory.header.type,
          sources: i.memory.header.sources,
          heardAt: i.memory.header.at,
          score: 0.5 + score / 10,
        }),
      );
    }
    case 'memory.save': {
      requirePaired(state);
      const ref = refFor(request.fact.id);
      state.items.push(item(memoryFromCandidate(request.fact, ref)));
      return { factId: request.fact.id, status: 'written', ref };
    }
    case 'memory.hide': {
      requirePaired(state);
      const target = state.items.find((i) => i.memory.ref === request.ref);
      if (!target) throw new Refusal('internal', 'No such memory.');
      target.memory = { ...target.memory, status: 'hidden', header: { ...target.memory.header, status: 'hidden' } };
      return { hidden: request.ref };
    }
    case 'memory.resolve': {
      requirePaired(state);
      const target = state.items.find((i) => i.conflict?.conflictId === request.conflictId);
      if (!target?.conflict) throw new Refusal('internal', 'No such conflict.');
      const conflict = target.conflict;
      const newer = (text: string): StoredMemory => ({
        ...target.memory,
        ref: refFor(conflict.otherRef),
        text,
        status: 'active',
        header: { ...target.memory.header, sources: conflict.otherSources, at: conflict.otherHeardAt, supersedes: target.memory.ref },
        writtenAt: new Date().toISOString(),
      });
      const resolution = request.resolution;
      const rest: LibraryItem = { memory: target.memory, endEpoch: target.endEpoch, blobId: target.blobId };
      const index = state.items.indexOf(target);
      if (resolution.kind === 'keep_old') {
        state.items[index] = { ...rest, memory: { ...target.memory, status: 'active' } };
      } else if (resolution.kind === 'keep_both') {
        state.items[index] = { ...rest, memory: { ...target.memory, status: 'active' } };
        state.items.push(item(newer(`${conflict.otherText} (${resolution.context})`)));
      } else {
        const replacement = newer(resolution.kind === 'merge' ? resolution.text : conflict.otherText);
        state.items[index] = { ...rest, memory: { ...target.memory, status: 'superseded', supersededBy: replacement.ref } };
        state.items.push(item(replacement));
      }
      return { resolved: request.conflictId };
    }
    case 'data.export': {
      requirePaired(state);
      const memories = state.items.map((i) => i.memory);
      const pam = await toPam(memories);
      return { pam: JSON.stringify(pam, null, 2), markdown: toMarkdown(memories), count: memories.filter((m) => m.status === 'active').length };
    }
  }
}

function progressOf(state: State) {
  const job = state.importJob;
  if (job === null) return { total: 0, written: 0, failed: 0, state: 'idle' as const };
  return { total: job.total, written: job.written, failed: 0, state: job.written >= job.total ? ('done' as const) : ('writing' as const) };
}

async function respond(message: unknown): Promise<unknown> {
  const parsed = WebAppRequest.safeParse(message);
  if (!parsed.success) {
    log({ type: typeof message === 'object' && message !== null ? String(Reflect.get(message, 'type')) : 'unknown', valid: false, ok: false });
    return { ok: false, code: 'invalid_message', message: 'Ferry refused a malformed request.' };
  }
  const state = load();
  try {
    const data = WebAppResponse[parsed.data.type].parse(await handle(parsed.data, state));
    save(state);
    log({ type: parsed.data.type, valid: true, ok: true });
    return { ok: true, data };
  } catch (error) {
    log({ type: parsed.data.type, valid: true, ok: false, ...(error instanceof Refusal ? {} : { error: String(error).slice(0, 2000) }) });
    if (error instanceof Refusal) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

interface FakeRuntime {
  lastError: { message: string } | undefined;
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
}

const runtime: FakeRuntime = {
  lastError: undefined,
  sendMessage(extensionId, message, callback) {
    setTimeout(() => {
      if (extensionId !== config.extensionId) {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        callback(undefined);
        runtime.lastError = undefined;
        return;
      }
      void respond(message).then(
        (response) => callback(response),
        (error: unknown) => {
          log({ type: 'crash', valid: true, ok: false, error: String(error instanceof Error ? error.stack : error).slice(0, 2000) });
          callback({ ok: false, code: 'internal', message: 'The fake extension failed.' });
        },
      );
    }, 5);
  },
};

const existing: unknown = Reflect.get(window, 'chrome');
const chromeObject = typeof existing === 'object' && existing !== null ? existing : {};
Reflect.set(chromeObject, 'runtime', runtime);
Reflect.set(window, 'chrome', chromeObject);
