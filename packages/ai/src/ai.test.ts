import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { buildDeskMessages, chooseProvider, streamDesk } from './desk.js';
import { createLlmJson, extractJson, LlmOutputError } from './json.js';
import { availableDeskProviders, deskModel, ProviderUnavailableError, utilityModel } from './models.js';
import { CONTEXT_HEADER, type DeskRequest } from '@ferry/core';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

describe('extractJson', () => {
  it('reads fenced, bare and prose-wrapped JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: [1,2] done')).toEqual([1, 2]);
  });
  it('throws typed errors', () => {
    expect(() => extractJson('no json')).toThrow(LlmOutputError);
    expect(() => extractJson('{"a":')).toThrow(LlmOutputError);
    expect(() => extractJson('{bad}')).toThrow(LlmOutputError);
  });
});

describe('createLlmJson', () => {
  it('calls the model and parses its JSON', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{"facts":[]}' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }),
    });
    const llm = createLlmJson(model);
    expect(await llm({ system: 's', user: 'u', schemaName: 'X', maxTokens: 10 })).toEqual({ facts: [] });
  });
});

describe('desk', () => {
  const req: DeskRequest = {
    provider: 'claude',
    cutOff: [],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'plan dinner' },
    ],
    context: [{ ref: '0xabcdef1234', text: 'Allergic to cashews.' }],
  };

  it('skips cut off providers and falls through in order', () => {
    expect(chooseProvider(req, ['claude', 'gpt'])).toBe('claude');
    expect(chooseProvider({ provider: 'claude', cutOff: ['claude'] }, ['claude', 'gpt', 'gemini'])).toBe('gpt');
    expect(chooseProvider({ provider: 'gpt', cutOff: ['gpt'] }, ['gemini'])).toBe('gemini');
    expect(chooseProvider({ provider: 'claude', cutOff: ['claude'] }, ['claude'])).toBeNull();
  });

  it('prefixes only the last user turn with the delimited context block', () => {
    const msgs = buildDeskMessages(req);
    expect(msgs[0]?.content).toBe('hi');
    expect(msgs[2]?.content.startsWith(CONTEXT_HEADER)).toBe(true);
    expect(msgs[2]?.content.endsWith('plan dinner')).toBe(true);
    expect(buildDeskMessages({ ...req, context: [] })[2]?.content).toBe('plan dinner');
  });

  it('streams text with the serving provider header', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'text-start', id: '1' });
            c.enqueue({ type: 'text-delta', id: '1', delta: 'Cashew free menu' });
            c.enqueue({ type: 'text-end', id: '1' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
            c.close();
          },
        }),
      }),
    });
    const res = streamDesk(req, model, 'gpt');
    expect(res.headers.get('x-ferry-provider')).toBe('gpt');
    expect(await res.text()).toBe('Cashew free menu');
  });
});

describe('models', () => {
  it('reports configured providers and refuses missing keys', () => {
    expect(availableDeskProviders({ ANTHROPIC_API_KEY: 'k', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })).toEqual(['claude', 'gemini']);
    expect(() => utilityModel({})).toThrow(ProviderUnavailableError);
    expect(() => deskModel('gpt', {})).toThrow(ProviderUnavailableError);
    expect(() => deskModel('gemini', {})).toThrow(ProviderUnavailableError);
    expect(() => deskModel('claude', {})).toThrow(ProviderUnavailableError);
    expect(utilityModel({ ANTHROPIC_API_KEY: 'k' })).toBeTruthy();
    expect(deskModel('claude', { ANTHROPIC_API_KEY: 'k' })).toBeTruthy();
    expect(deskModel('gpt', { OPENAI_API_KEY: 'k' })).toBeTruthy();
    expect(deskModel('gemini', { GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toBeTruthy();
  });
});
