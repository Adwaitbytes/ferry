import { describe, expect, it } from 'vitest';
import {
  ContentRequest,
  DistillRequest,
  ExtensionStatus,
  GateRecallResult,
  LibraryPage,
  PairingOffer,
  PanelRequest,
  PanelResponse,
  PUBLIC_REDACTED_HASH,
  PublishableFacts,
  publishableToCandidate,
  SaveResult,
  WebAppRequest,
  WebAppResponse,
  keyFingerprint,
} from './contracts.js';

const fact = {
  id: '6f1c1f1e-8a6c-4b6a-9d55-0d6a2f4b9b11',
  text: 'Allergic to cashews.',
  type: 'constraint',
  receipts: [
    {
      vendor: 'chatgpt',
      conversationIdHash: 'AbCdEfGh12345678',
      messageAt: '2026-11-08T10:00:00Z',
      quote: "I'm allergic to cashews",
      quoteHash: 'QqQqQqQq_-123456',
      confidence: 0.95,
    },
  ],
  sensitive: [],
  flags: [],
};

describe('extension message contracts', () => {
  it('accepts well formed content messages', () => {
    expect(ContentRequest.safeParse({ type: 'recall.suggest', site: 'claude', draft: 'plan dinner' }).success).toBe(true);
    expect(ContentRequest.safeParse({ type: 'capture.save', site: 'chatgpt', fact }).success).toBe(true);
  });

  it('rejects unknown types, sites and privileged requests from content scripts', () => {
    expect(ContentRequest.safeParse({ type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' }).success).toBe(false);
    expect(ContentRequest.safeParse({ type: 'recall.suggest', site: 'evil.com', draft: '' }).success).toBe(false);
    expect(ContentRequest.safeParse({ type: 'capture.propose', site: 'chatgpt', userText: 'x', conversationUrl: ['javascript', ':alert(1)'].join('') }).success).toBe(false);
  });

  it('never lets the web app wipe local data or change settings', () => {
    expect(WebAppRequest.safeParse({ type: 'pairing.begin' }).success).toBe(true);
    expect(WebAppRequest.safeParse({ type: 'memory.recall', query: 'food', limit: 5 }).success).toBe(true);
    expect(WebAppRequest.safeParse({ type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' }).success).toBe(false);
    expect(WebAppRequest.safeParse({ type: 'settings.set', patch: {} }).success).toBe(false);
  });

  it('requires the typed wipe confirmation', () => {
    expect(PanelRequest.safeParse({ type: 'data.wipe', confirm: 'yes' }).success).toBe(false);
    expect(PanelRequest.safeParse({ type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' }).success).toBe(true);
  });
});

describe('HTTP contracts', () => {
  it('bounds distill batches', () => {
    const chunk = { chunkId: 'c1', vendor: 'chatgpt', conversationIdHash: 'AbCdEfGh12345678', messageAt: '2026-11-08T10:00:00Z', userText: 'hi' };
    expect(DistillRequest.safeParse({ chunks: [chunk] }).success).toBe(true);
    expect(DistillRequest.safeParse({ chunks: Array(17).fill(chunk) }).success).toBe(false);
    expect(DistillRequest.safeParse({ chunks: [{ ...chunk, userText: 'x'.repeat(6001) }] }).success).toBe(false);
  });

  it('validates gate results', () => {
    const ok = GateRecallResult.safeParse({
      cardId: 'AAAAAAAAAAAAAAAAAAAAAA',
      results: [{ text: 'Vegetarian', type: 'preference', sources: ['chatgpt'], heardAt: '2026-11-01', memoryRef: '0xabcdef1234' }],
      payment: { digest: 'D1g3st', amountMicros: '10000', receiptId: 'r1', payer: '0x1' },
    });
    expect(ok.success).toBe(true);
  });
});

const HEX32 = ['0123', '4567', '89ab', 'cdef'].join('').repeat(4);
const ACCOUNT = `0x${'ab'.repeat(32)}`;

const memory = {
  ref: 'blob-0000000001',
  namespace: 'ferry-core',
  text: 'Allergic to cashews.',
  header: {
    v: 1,
    type: 'constraint',
    sources: ['chatgpt'],
    convHash: 'AbCdEfGh12345678',
    at: '2026-11-01',
    confidence: 0.9,
    quoteHash: 'QqQqQqQq_-123456',
    supersedes: null,
    status: 'active',
  },
  status: 'conflict',
  receipts: [],
  writtenAt: '2026-11-01T10:00:00Z',
  supersededBy: null,
};

const status = {
  lock: 'open',
  locked: false,
  paired: true,
  accountId: ACCOUNT,
  publicKeyHex: HEX32,
  fingerprint: keyFingerprint(HEX32),
  suiAddress: `0x${'cd'.repeat(32)}`,
  account: { accountId: ACCOUNT, owner: `0x${'ef'.repeat(32)}`, pairedAt: '2026-11-08T10:00:00.000Z' },
  autoLockMinutes: 30,
  msUntilAutoLock: 1000,
  governor: { kind: 'ready' },
  importProgress: { total: 0, written: 0, failed: 0, state: 'idle' },
};

describe('extension response contracts', () => {
  it('formats the pairing fingerprint as first 8 and last 8 hex in groups of 4', () => {
    expect(keyFingerprint(HEX32)).toBe('0123 4567 89ab cdef');
    expect(keyFingerprint(`0x${HEX32.toUpperCase()}`)).toBe('0123 4567 89ab cdef');
    expect(() => keyFingerprint('abc')).toThrow(RangeError);
  });

  it('accepts a full status and keeps panel-only fields optional', () => {
    expect(ExtensionStatus.safeParse(status).success).toBe(true);
    const panel = { ...status, adapters: { claude: { ok: true, detail: 'fine', at: 1 } }, recentCaptures: [] };
    expect(ExtensionStatus.parse(panel).adapters?.claude?.ok).toBe(true);
    expect(ExtensionStatus.safeParse({ ...status, governor: { kind: 'cooling_down', reason: 'pacing', resumeAt: 5 } }).success).toBe(true);
  });

  it('rejects a status with a malformed key, fingerprint or account', () => {
    expect(ExtensionStatus.safeParse({ ...status, publicKeyHex: HEX32.slice(1) }).success).toBe(false);
    expect(ExtensionStatus.safeParse({ ...status, fingerprint: '01234567cdefcdef' }).success).toBe(false);
    expect(ExtensionStatus.safeParse({ ...status, accountId: '0x1' }).success).toBe(false);
    expect(ExtensionStatus.safeParse({ ...status, importProgress: undefined }).success).toBe(false);
  });

  it('validates pairing offers', () => {
    const offer = { publicKeyHex: HEX32, suiAddress: '0x1', fingerprint: keyFingerprint(HEX32), label: 'Chrome on Mac', accountId: null };
    expect(PairingOffer.safeParse(offer).success).toBe(true);
    expect(PairingOffer.safeParse({ ...offer, publicKeyHex: `0x${HEX32}` }).success).toBe(false);
  });

  it('carries conflict records on library items', () => {
    const conflict = {
      conflictId: '6f1c1f1e-8a6c-4b6a-9d55-0d6a2f4b9b11',
      otherRef: '6f1c1f1e-8a6c-4b6a-9d55-0d6a2f4b9b12',
      otherText: 'Eats cashews now.',
      otherSources: ['claude'],
      otherHeardAt: '2026-11-08',
      verdict: 'contradicts',
    };
    const page = { items: [{ memory, endEpoch: 12, blobId: memory.ref, conflict }], nextCursor: null };
    expect(LibraryPage.safeParse(page).success).toBe(true);
    expect(LibraryPage.safeParse({ ...page, items: [{ ...page.items[0], conflict: { ...conflict, verdict: 'same' } }] }).success).toBe(false);
  });

  it('shapes save results like memwal FactWriteResult', () => {
    expect(SaveResult.safeParse({ factId: 'f1', status: 'written', ref: 'blob-0000000001' }).success).toBe(true);
    expect(SaveResult.safeParse({ factId: 'f1', status: 'blocked', categories: ['password'] }).success).toBe(true);
    expect(SaveResult.safeParse({ factId: 'f1', status: 'blocked', categories: ['nonsense'] }).success).toBe(false);
    expect(SaveResult.safeParse({ kind: 'written', ref: 'blob-0000000001' }).success).toBe(false);
  });

  it('has a response schema for every web app and panel request type', () => {
    const webTypes = WebAppRequest.options.map((o) => o.shape.type.value);
    expect(Object.keys(WebAppResponse).sort()).toEqual([...webTypes].sort());
    const panelTypes = PanelRequest.options.map((o) => o.shape.type.value).filter((t) => !t.startsWith('settings.'));
    expect(Object.keys(PanelResponse).sort()).toEqual([...panelTypes].sort());
  });

  it('validates the remaining response payloads', () => {
    expect(WebAppResponse['memory.recall'].safeParse([]).success).toBe(true);
    expect(WebAppResponse['memory.recall'].safeParse({ suggestions: [] }).success).toBe(false);
    expect(WebAppResponse['data.export'].safeParse({ pam: '{}', markdown: '# Ferry', count: 0 }).success).toBe(true);
    expect(WebAppResponse['import.enqueue'].safeParse({ queued: 3, dropped: 1 }).success).toBe(true);
    expect(WebAppResponse['memory.hide'].safeParse({ hidden: 'blob-0000000001' }).success).toBe(true);
    expect(WebAppResponse['memory.resolve'].safeParse({ resolved: 'not-a-uuid' }).success).toBe(false);
    expect(WebAppResponse['pairing.confirm'].safeParse({ accountId: ACCOUNT, owner: '0x1' }).success).toBe(true);
  });
});

describe('side panel Now and Vault contracts', () => {
  it('lets only the panel ask for a tab\'s suggestions and insert them', () => {
    expect(PanelRequest.safeParse({ type: 'now.suggestions', tabId: 12 }).success).toBe(true);
    expect(PanelRequest.safeParse({ type: 'now.suggestions', tabId: -1 }).success).toBe(false);
    expect(PanelRequest.safeParse({ type: 'now.insert', tabId: 12, refs: ['blob-0000000001'] }).success).toBe(true);
    expect(PanelRequest.safeParse({ type: 'now.insert', tabId: 12, refs: [] }).success).toBe(false);
    expect(PanelRequest.safeParse({ type: 'now.insert', tabId: 12, refs: Array(21).fill('blob-0000000001') }).success).toBe(false);
    expect(WebAppRequest.safeParse({ type: 'now.insert', tabId: 12, refs: ['blob-0000000001'] }).success).toBe(false);
    expect(ContentRequest.safeParse({ type: 'now.suggestions', tabId: 12 }).success).toBe(false);
  });

  it('accepts a BYOK embedding setup only over https and only from the panel', () => {
    // Built from fragments so no key-shaped literal sits in the repo (THREAT_MODEL X-CI-2).
    const embedding = { apiKey: ['sk', 'test', '0123456789'].join('-'), apiBase: 'https://api.openai.com/v1' };
    expect(PanelRequest.safeParse({ type: 'vault.enable', embedding }).success).toBe(true);
    expect(PanelRequest.safeParse({ type: 'vault.enable', embedding: { ...embedding, apiBase: 'http://api.openai.com/v1' } }).success).toBe(false);
    expect(PanelRequest.safeParse({ type: 'vault.enable', embedding: { apiKey: 'short' } }).success).toBe(false);
    expect(WebAppRequest.safeParse({ type: 'vault.enable', embedding }).success).toBe(false);
    expect(ContentRequest.safeParse({ type: 'vault.status' }).success).toBe(false);
  });

  it('validates Now and Vault responses', () => {
    const suggestion = { ref: 'blob-0000000001', text: 'Vegetarian', type: 'preference', sources: ['chatgpt'], heardAt: '2026-10-12', score: 0.9 };
    expect(PanelResponse['now.suggestions'].safeParse({ site: 'claude', suggestions: [suggestion], updatedAt: 1 }).success).toBe(true);
    expect(PanelResponse['now.suggestions'].safeParse({ site: null, suggestions: [], updatedAt: null }).success).toBe(true);
    expect(PanelResponse['now.insert'].safeParse({ inserted: 0 }).success).toBe(false);
    expect(PanelResponse['vault.status'].safeParse({ mode: 'vault', embedding: { apiBase: 'https://api.openai.com/v1', model: 'text-embedding-3-small' }, sealSigner: 'delegate' }).success).toBe(true);
    expect(PanelResponse['vault.status'].safeParse({ mode: 'vault', embedding: { apiKey: 'sk' }, sealSigner: 'delegate' }).success).toBe(false);
    expect(PanelResponse['vault.status'].safeParse({ mode: 'private', embedding: null, sealSigner: 'delegate' }).success).toBe(false);
  });
});

describe('publishing contracts', () => {
  const id = '6f1c1f1e-8a6c-4b6a-9d55-0d6a2f4b9b11';

  it('redacts conversation and quote hashes and keeps every source', () => {
    const fact = publishableToCandidate({ text: ' Vegetarian. ', type: 'preference', sources: ['chatgpt', 'claude', 'chatgpt'], heardAt: '2026-10-01' }, id, '2026-11-09');
    expect(fact.text).toBe('Vegetarian.');
    expect(fact.receipts.map((r) => r.vendor)).toEqual(['chatgpt', 'claude']);
    expect(fact.receipts.every((r) => r.conversationIdHash === PUBLIC_REDACTED_HASH && r.quoteHash === PUBLIC_REDACTED_HASH && r.quote === '')).toBe(true);
    expect(fact.receipts[0]?.messageAt).toBe('2026-10-01T00:00:00Z');
  });

  it('defaults to a manual source heard today', () => {
    const fact = publishableToCandidate({ text: 'Likes trains', type: 'preference' }, id, '2026-11-09');
    expect(fact.receipts).toMatchObject([{ vendor: 'manual', messageAt: '2026-11-09T00:00:00Z' }]);
  });

  it('bounds the file and rejects unknown types', () => {
    expect(PublishableFacts.safeParse([]).success).toBe(false);
    expect(PublishableFacts.safeParse([{ text: 'x', type: 'secret' }]).success).toBe(false);
    expect(PublishableFacts.safeParse(Array(201).fill({ text: 'x', type: 'goal' })).success).toBe(false);
  });
});
