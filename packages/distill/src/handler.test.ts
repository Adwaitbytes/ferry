import { describe, expect, it, vi } from 'vitest';
import { createSafeLogger, handleDistillRequest, MAX_DISTILL_BODY_BYTES, type SafeLogEvent } from './handler.js';
import type { LlmJson } from './llm.js';

const CHUNK = { chunkId: 'c1', vendor: 'paste', conversationIdHash: 'AbCdEfGh12345678', messageAt: '2026-11-08T10:00:00Z', userText: 'I live in Pune.' };

describe('handleDistillRequest', () => {
  it('returns distilled facts and logs only safe fields', async () => {
    const events: SafeLogEvent[] = [];
    let t = 100;
    const llm: LlmJson = () =>
      Promise.resolve({ facts: [{ chunkId: 'c1', text: 'Lives in Pune.', type: 'identity', quote: 'I live in Pune', confidence: 0.9, sensitive: [], injectionSuspect: false }] });
    const res = await handleDistillRequest(JSON.stringify({ chunks: [CHUNK] }), { llm, log: (e) => events.push(e), requestId: 'r1', now: () => (t += 5) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ facts: [expect.objectContaining({ text: 'Lives in Pune.', injectionSuspect: false })] });
    expect(events).toEqual([{ route: 'distill', status: 200, durationMs: 5, requestId: 'r1', chunkCount: 1 }]);
  });

  it('rejects oversize bodies, bad JSON, and malformed LLM output with codes', async () => {
    const llm = vi.fn<LlmJson>().mockResolvedValue('not an object');
    const log = vi.fn();
    expect(await handleDistillRequest('x'.repeat(MAX_DISTILL_BODY_BYTES + 1), { llm, log })).toEqual({ status: 413, body: { error: 'BODY_TOO_LARGE' } });
    expect(await handleDistillRequest('{', { llm, log })).toEqual({ status: 400, body: { error: 'INVALID_REQUEST' } });
    expect(await handleDistillRequest(JSON.stringify({ chunks: [CHUNK] }), { llm, log })).toEqual({ status: 502, body: { error: 'LLM_FAILED' } });
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[2]?.[0]).toMatchObject({ code: 'LLM_FAILED', chunkCount: 1 });
  });
});

describe('createSafeLogger', () => {
  it('drops unknown fields and redacts non-identifier strings', () => {
    const lines: string[] = [];
    const log = createSafeLogger((l) => lines.push(l));
    const hostile = { route: 'distill', status: 200, durationMs: Number.NaN, code: 'has spaces', walletHash: 'abc_123', body: 'secret text' };
    log(hostile as SafeLogEvent);
    expect(JSON.parse(lines[0] ?? '')).toEqual({ route: 'distill', walletHash: 'abc_123', code: '[redacted]', status: 200 });
  });
});
