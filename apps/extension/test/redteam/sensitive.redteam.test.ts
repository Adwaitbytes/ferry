import { describe, expect, it } from 'vitest';
import { contentSender, openPaired, panelSender } from '../helpers';

describe('sensitive data in capture', () => {
  it('RT-75 health statement with auto mode on still shows the toast and does not save', async () => {
    const h = await openPaired();
    await h.worker.route(
      { type: 'settings.set', patch: { sites: { chatgpt: { auto: true } } } },
      panelSender,
      'internal',
    );
    const payload = 'I was diagnosed with type 2 diabetes in March';
    h.api.distilled = [
      {
        chunkId: 'live-0',
        text: 'Was diagnosed with type 2 diabetes in March',
        type: 'identity',
        quote: payload,
        confidence: 0.9,
        sensitive: [],
        injectionSuspect: false,
      },
    ];
    const res = await h.worker.route(
      { type: 'capture.propose', site: 'chatgpt', userText: `${payload}. I usually cook at home.` },
      contentSender('chatgpt'),
      'internal',
    );
    expect(res).toMatchObject({
      ok: true,
      data: { autoSaved: false, proposal: { sensitive: true } },
    });
    expect(h.engine.saveFact).not.toHaveBeenCalled();
  });
});
