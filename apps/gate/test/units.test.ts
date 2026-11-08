import { encodeMemory } from '@ferry/core';
import { describe, expect, it } from 'vitest';
import { loadGateConfig } from '../src/config.js';
import { createGateLogger } from '../src/log.js';
import { toPublicFact } from '../src/recall.js';
import { chainVerifier } from '../src/verifier.js';

const header = { v: 1 as const, type: 'preference' as const, sources: ['chatgpt' as const, 'claude' as const], convHash: 'convHASH1234', at: '2026-10-12', confidence: 0.9, quoteHash: 'quoteHASH123', supersedes: null, status: 'active' as const };

describe('toPublicFact (X-GATE-3)', () => {
  it('drops the conversation and quote hashes and keeps only type, sources and date', () => {
    const { memoryText } = encodeMemory('Allergic to cashews.', header);
    const fact = toPublicFact(memoryText, 'blob_AAAAAAAAAAAA');
    expect(fact).toEqual({ text: 'Allergic to cashews.', type: 'preference', sources: ['chatgpt', 'claude'], heardAt: '2026-10-12', memoryRef: 'blob_AAAAAAAAAAAA' });
    expect(JSON.stringify(fact)).not.toMatch(/convHASH|quoteHASH/);
  });

  it('serves nothing without a valid active Ferry header or with a bad ref', () => {
    expect(toPublicFact('plain text memory', 'blob_AAAAAAAAAAAA')).toBeNull();
    expect(toPublicFact(encodeMemory('Hidden.', { ...header, status: 'hidden' }).memoryText, 'blob_AAAAAAAAAAAA')).toBeNull();
    expect(toPublicFact(encodeMemory('Fine.', header).memoryText, 'bad ref!')).toBeNull();
  });
});

const validEnv = {
  DATABASE_URL: 'postgres://u@h/db',
  GATE_MPP_SECRET_KEY: 'm'.repeat(40),
  GATE_PUBLIC_ACCOUNT_ID: `0x${'ab'.repeat(32)}`,
  GATE_PUBLIC_ACCOUNT_OWNER: `0x${'cd'.repeat(32)}`,
  GATE_DELEGATE_PRIVATE_KEY: 'k'.repeat(64),
  SESSION_SECRET: 's'.repeat(40),
  NEXT_PUBLIC_FERRY_WEB_ORIGIN: 'https://ferry.example',
};

describe('loadGateConfig (X-GATE-1)', () => {
  it('parses a valid environment with defaults', () => {
    expect(loadGateConfig(validEnv)).toMatchObject({ GATE_REALM: 'ferry-gate', MEMWAL_RELAYER_URL: 'https://relayer.memory.walrus.xyz' });
  });
  it('names missing variables without echoing values', () => {
    expect(() => loadGateConfig({ ...validEnv, SESSION_SECRET: 'short-secret-value' })).toThrow(/SESSION_SECRET/);
    expect(() => loadGateConfig({ ...validEnv, SESSION_SECRET: 'short-secret-value' })).not.toThrow(/short-secret-value/);
  });
  it('refuses to start on a private account', () => {
    expect(() => loadGateConfig({ ...validEnv, GATE_PRIVATE_ACCOUNT_IDS: `0x1, ${validEnv.GATE_PUBLIC_ACCOUNT_ID}` })).toThrow(/private account/);
  });
});

describe('chainVerifier', () => {
  const request = { digest: 'd', recipient: '0x1', coinType: 'c', minAmountMicros: 1n, notBeforeMs: 0, notAfterMs: 1 };
  it('maps chain results and treats errors as retryable not-found', async () => {
    const ok = chainVerifier({
      verifyUsdcPayment: async () => ({ ok: true, digest: 'd', payer: '0xp', recipient: '0x1', coinType: 'c', amountMicros: 5n, checkpoint: 1n, timestampMs: 2 }),
    });
    expect(await ok.verify(request)).toEqual({ ok: true, sender: '0xp', amountMicros: 5n, checkpoint: 1n, timestampMs: 2 });
    const bad = chainVerifier({ verifyUsdcPayment: async () => ({ ok: false, digest: 'd', reason: 'WRONG_COIN' }) });
    expect(await bad.verify(request)).toEqual({ ok: false, reason: 'WRONG_COIN' });
    const down = chainVerifier({ verifyUsdcPayment: async () => Promise.reject(new Error('429')) });
    expect(await down.verify(request)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

describe('createGateLogger (X-LOG-1)', () => {
  it('keeps allowlisted fields and redacts anything that is not id-shaped', () => {
    const lines: string[] = [];
    const log = createGateLogger((line) => lines.push(line));
    log({ route: '/v1/cards/:cardId', method: 'GET', status: 200, durationMs: 1.6, cardId: 'abc', code: 'I like cashews' });
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ route: '/v1/cards/:cardId', method: 'GET', status: 200, durationMs: 2, cardId: 'abc', code: '[redacted]' });
  });
});

describe('memwalPublicRecall', () => {
  it('pins the namespace and filters hits through toPublicFact', async () => {
    const { MemWal } = await import('@mysten-incubation/memwal');
    const calls: unknown[] = [];
    const original = MemWal.create;
    MemWal.create = ((config: unknown) => {
      calls.push(config);
      return {
        recall: async (params: unknown) => {
          calls.push(params);
          return { results: [{ blob_id: 'blob_AAAAAAAAAAAA', text: encodeMemory('Likes trains.', header).memoryText, distance: 0.1 }, { blob_id: 'blob_BBBBBBBBBBBB', text: 'no header', distance: 0.2 }], total: 2 };
        },
      };
    }) as unknown as typeof MemWal.create;
    try {
      const { memwalPublicRecall } = await import('../src/recall.js');
      const facts = await memwalPublicRecall({ delegateKey: 'k', accountId: '0x1', relayerUrl: 'https://r.test' }).recall('trains', 5);
      expect(facts.map((f) => f.text)).toEqual(['Likes trains.']);
      expect(calls).toEqual([
        { key: 'k', accountId: '0x1', serverUrl: 'https://r.test', namespace: 'ferry-public' },
        { query: 'trains', limit: 5, namespace: 'ferry-public' },
      ]);
    } finally {
      MemWal.create = original;
    }
  });

  it('wraps verifiers with finality retry', async () => {
    const { tatumVerifier } = await import('../src/verifier.js');
    const v = tatumVerifier({ verifyUsdcPayment: async () => ({ ok: false, digest: 'd', reason: 'UNDERPAID' }) });
    expect(await v.verify({ digest: 'd', recipient: '0x1', coinType: 'c', minAmountMicros: 1n, notBeforeMs: 0, notAfterMs: 1 })).toEqual({ ok: false, reason: 'UNDERPAID' });
  });
});
