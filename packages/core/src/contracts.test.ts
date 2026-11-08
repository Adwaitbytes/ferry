import { describe, expect, it } from 'vitest';
import { ContentRequest, DistillRequest, GateRecallResult, PanelRequest, WebAppRequest } from './contracts.js';

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

  it('only lets the web app pair and import', () => {
    expect(WebAppRequest.safeParse({ type: 'pairing.begin' }).success).toBe(true);
    expect(WebAppRequest.safeParse({ type: 'memory.hide', ref: '0xabcdef1234' }).success).toBe(false);
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
