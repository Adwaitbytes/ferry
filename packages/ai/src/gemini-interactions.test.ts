import { describe, expect, it } from 'vitest';
import type { DeskRequest } from '@ferry/core';
import { deskViaInteractions, readInteractionText, toInteractionSteps, usesInteractionsKey } from './gemini-interactions.js';

const req: DeskRequest = {
  provider: 'gemini',
  cutOff: ['claude'],
  messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'plan my week' },
  ],
  context: [{ ref: '0xabcdef123456', text: 'Product priority is Select 360 first.' }],
};

describe('gemini interactions', () => {
  it('maps the thread to steps with rules first and context on the last user turn', () => {
    const steps = toInteractionSteps(req);
    expect(steps.map((s) => s.type)).toEqual(['user_input', 'model_output', 'user_input']);
    expect(steps[0]?.content[0]?.text).toContain('Ferry Desk');
    expect(steps[2]?.content[0]?.text).toContain('Select 360');
  });

  it('reads only model text', () => {
    expect(readInteractionText({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'Focus on ' }, { type: 'text', text: 'Select 360.' }] }] })).toBe('Focus on Select 360.');
    expect(readInteractionText({})).toBe('');
  });

  it('detects interactions-scoped keys', () => {
    expect(usesInteractionsKey('AQ.abc')).toBe(true);
    expect(usesInteractionsKey('AIzaabc')).toBe(false);
    expect(usesInteractionsKey(undefined)).toBe(false);
  });

  it('returns text with the serving provider header and fails loudly on errors', async () => {
    const ok = (async () => Response.json({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Do Select 360.' }] }] })) as typeof fetch;
    const res = await deskViaInteractions(req, { apiKey: 'AQ.x', served: 'gemini', fetchImpl: ok });
    expect(res.headers.get('x-ferry-provider')).toBe('gemini');
    expect(await res.text()).toBe('Do Select 360.');
    const bad = (async () => new Response('', { status: 500 })) as typeof fetch;
    await expect(deskViaInteractions(req, { apiKey: 'AQ.x', served: 'gemini', fetchImpl: bad })).rejects.toThrow(/500/);
    const empty = (async () => Response.json({ steps: [] })) as typeof fetch;
    await expect(deskViaInteractions(req, { apiKey: 'AQ.x', served: 'gemini', fetchImpl: empty })).rejects.toThrow(/no text/);
  });
});
