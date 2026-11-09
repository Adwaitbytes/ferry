import { describe, expect, it } from 'vitest';
import { parseWorkerCommand } from '../src/lib/protocol';
import { contentSender, harness, openPaired, panelSender, webSender } from './helpers';

const suggestDraft = (h: Awaited<ReturnType<typeof openPaired>>, tabId = 4) =>
  h.worker.route(
    { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for friday' },
    contentSender('claude', tabId),
    'internal',
  );

describe('side panel Now tab', () => {
  it('mirrors what the chat tab last recalled, without another relayer call', async () => {
    const h = await openPaired();
    expect(
      await h.worker.route({ type: 'now.suggestions', tabId: 4 }, panelSender, 'internal'),
    ).toEqual({ ok: true, data: { site: null, suggestions: [], updatedAt: null } });

    await suggestDraft(h);
    expect(h.engine.recallForDraft).toHaveBeenCalledTimes(1);
    const res = await h.worker.route(
      { type: 'now.suggestions', tabId: 4 },
      panelSender,
      'internal',
    );
    expect(res).toMatchObject({
      ok: true,
      data: { site: 'claude', updatedAt: h.clock.t },
    });
    if (!res.ok) throw new Error('expected suggestions');
    expect(
      (res.data as { suggestions: { text: string }[] }).suggestions.map((s) => s.text),
    ).toEqual(['Vegetarian', 'Allergic to cashews']);
    expect(h.engine.recallForDraft).toHaveBeenCalledTimes(1);
  });

  it("inserts through the tab's content script, which composes with inject.compose", async () => {
    const h = await openPaired();
    await suggestDraft(h);
    h.tabReply.value = { inserted: 2 };
    const res = await h.worker.route(
      { type: 'now.insert', tabId: 4, refs: ['blob-aaaaaaaa1', 'blob-aaaaaaaa2'] },
      panelSender,
      'internal',
    );
    expect(res).toEqual({ ok: true, data: { inserted: 2 } });
    expect(h.tabMessages).toEqual([
      {
        tabId: 4,
        message: { type: 'ferry.insert-refs', refs: ['blob-aaaaaaaa1', 'blob-aaaaaaaa2'] },
      },
    ]);
  });

  it('refuses refs that tab was never shown and never messages the tab', async () => {
    const h = await openPaired();
    await suggestDraft(h);
    for (const [tabId, refs] of [
      [4, ['blob-zzzzzzzz9']],
      [5, ['blob-aaaaaaaa1']],
    ] as const) {
      expect(
        await h.worker.route(
          { type: 'now.insert', tabId, refs: [...refs] },
          panelSender,
          'internal',
        ),
      ).toMatchObject({ ok: false, code: 'invalid_message' });
    }
    expect(h.tabMessages).toEqual([]);
  });

  it('says so when the tab has no composer or does not answer', async () => {
    const h = await openPaired();
    await suggestDraft(h);
    const insert = () =>
      h.worker.route(
        { type: 'now.insert', tabId: 4, refs: ['blob-aaaaaaaa1'] },
        panelSender,
        'internal',
      );
    h.tabReply.value = { inserted: 0 };
    expect(await insert()).toMatchObject({ ok: false, code: 'upstream', message: /message box/ });
    h.tabReply.value = new Error('Could not establish connection');
    expect(await insert()).toMatchObject({
      ok: false,
      code: 'upstream',
      message: /did not answer/,
    });
    h.tabReply.value = { inserted: 9 };
    expect(await insert()).toEqual({ ok: true, data: { inserted: 1 } });
  });

  it('is panel only and needs Ferry open', async () => {
    const h = await openPaired();
    expect(
      await h.worker.route({ type: 'now.suggestions', tabId: 4 }, contentSender(), 'internal'),
    ).toMatchObject({ ok: false, code: 'forbidden_sender' });
    expect(
      await h.worker.route(
        { type: 'now.insert', tabId: 4, refs: ['blob-aaaaaaaa1'] },
        webSender,
        'external',
      ),
    ).toMatchObject({ ok: false, code: 'forbidden_sender' });
    await h.worker.route({ type: 'lock' }, panelSender, 'internal');
    expect(
      await h.worker.route({ type: 'now.suggestions', tabId: 4 }, panelSender, 'internal'),
    ).toMatchObject({ ok: false, code: 'locked' });
  });

  it('forgets a closed tab', async () => {
    const h = await openPaired();
    await suggestDraft(h);
    h.worker.forgetTab(4);
    expect(
      await h.worker.route({ type: 'now.suggestions', tabId: 4 }, panelSender, 'internal'),
    ).toMatchObject({ ok: true, data: { suggestions: [] } });
  });

  it('starts empty before setup', async () => {
    const h = harness();
    expect(
      await h.worker.route({ type: 'now.suggestions', tabId: 4 }, panelSender, 'internal'),
    ).toMatchObject({ ok: false, code: 'locked' });
  });
});

describe('worker to content commands', () => {
  it('accepts only well formed commands', () => {
    expect(parseWorkerCommand({ type: 'ferry.insert-suggested' })).toEqual({
      type: 'ferry.insert-suggested',
    });
    expect(parseWorkerCommand({ type: 'ferry.insert-refs', refs: ['blob-aaaaaaaa1'] })).toEqual({
      type: 'ferry.insert-refs',
      refs: ['blob-aaaaaaaa1'],
    });
    for (const bad of [
      null,
      'ferry.insert-refs',
      { type: 'ferry.insert-refs', refs: [] },
      { type: 'ferry.insert-refs', refs: ['<img src=x>'] },
      { type: 'ferry.insert-refs', refs: Array(21).fill('blob-aaaaaaaa1') },
      { type: 'ferry.insert-refs', refs: 'blob-aaaaaaaa1' },
      { type: 'something-else' },
    ]) {
      expect(parseWorkerCommand(bad)).toBeNull();
    }
  });
});
