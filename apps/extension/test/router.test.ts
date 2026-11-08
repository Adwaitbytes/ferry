import { describe, expect, it } from 'vitest';
import { classifyExternal, classifyInternal } from '../src/worker/senders';
import {
  ACCOUNT_ID,
  EXT_ID,
  FERRY_WEB_ORIGIN,
  contentSender,
  harness,
  openPaired,
  panelSender,
  webSender,
} from './helpers';

describe('sender classification', () => {
  it('accepts a top-frame content script on an exact chat origin', () => {
    expect(classifyInternal(contentSender('chatgpt'), EXT_ID)).toEqual({
      kind: 'content',
      site: 'chatgpt',
      tabId: 4,
    });
  });

  it('rejects lookalike, plain http and query-smuggled hosts', () => {
    for (const url of [
      'https://chatgpt.com.evil.example/c/1',
      'http://chatgpt.com/c/1',
      'https://evil.example/?u=https://chatgpt.com',
      'https://claude.ai.evil.example/',
    ]) {
      expect(classifyInternal({ id: EXT_ID, tab: { id: 4, url }, frameId: 0 }, EXT_ID).kind).toBe(
        'forbidden',
      );
    }
  });

  it('rejects a subframe even on a supported site', () => {
    expect(
      classifyInternal(
        {
          id: EXT_ID,
          tab: { id: 9, url: 'https://gemini.google.com/app' },
          frameId: 3,
          url: 'https://ads.example/frame.html',
        },
        EXT_ID,
      ).kind,
    ).toBe('forbidden');
  });

  it('rejects a top frame whose own url disagrees with the tab', () => {
    expect(
      classifyInternal(
        {
          id: EXT_ID,
          tab: { id: 4, url: 'https://claude.ai/' },
          frameId: 0,
          url: 'https://evil.example/',
        },
        EXT_ID,
      ).kind,
    ).toBe('forbidden');
  });

  it('accepts only our own extension pages without a tab', () => {
    expect(classifyInternal(panelSender, EXT_ID).kind).toBe('extension_page');
    expect(
      classifyInternal(
        { id: EXT_ID, url: 'chrome-extension://otherextensionidaaaaaaaaaaaaaaaa/x.html' },
        EXT_ID,
      ).kind,
    ).toBe('forbidden');
    expect(
      classifyInternal({ id: 'other', url: `chrome-extension://${EXT_ID}/sidepanel.html` }, EXT_ID)
        .kind,
    ).toBe('forbidden');
  });

  it('accepts external messages only from the exact web origin', () => {
    expect(classifyExternal(webSender, FERRY_WEB_ORIGIN).kind).toBe('web_app');
    expect(classifyExternal({ url: `${FERRY_WEB_ORIGIN}/pair` }, FERRY_WEB_ORIGIN).kind).toBe(
      'forbidden',
    );
    expect(
      classifyExternal({ origin: FERRY_WEB_ORIGIN, url: 'https://evil.example/' }, FERRY_WEB_ORIGIN)
        .kind,
    ).toBe('forbidden');
  });
});

describe('message router', () => {
  it('rejects malformed payloads as invalid_message', async () => {
    const { worker } = await openPaired();
    for (const raw of [
      null,
      'recall',
      42,
      [],
      { type: 'recall.suggest' },
      { type: 'recall.suggest', site: 'claude', draft: 5 },
      { type: 'nope' },
    ]) {
      const res = await worker.route(raw, contentSender(), 'internal');
      expect(res).toMatchObject({ ok: false, code: 'invalid_message' });
    }
  });

  it('rejects panel-only types from a content script as forbidden_sender', async () => {
    const { worker, wiped } = await openPaired();
    for (const msg of [
      { type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' },
      { type: 'settings.set', patch: {} },
      { type: 'lock' },
      { type: 'memory.hide', ref: 'blob-aaaaaaaa1' },
      { type: 'data.export' },
    ]) {
      expect(await worker.route(msg, contentSender(), 'internal')).toMatchObject({
        ok: false,
        code: 'forbidden_sender',
      });
    }
    expect(wiped.count).toBe(0);
  });

  it('rejects data.wipe from the web app', async () => {
    const { worker, wiped } = await openPaired();
    expect(
      await worker.route(
        { type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' },
        webSender,
        'external',
      ),
    ).toMatchObject({ ok: false, code: 'forbidden_sender' });
    expect(wiped.count).toBe(0);
  });

  it('rejects a content message that names a different site than its sender', async () => {
    const h = await openPaired();
    expect(
      await h.worker.route(
        { type: 'recall.suggest', site: 'chatgpt', draft: 'plan dinner' },
        contentSender('claude'),
        'internal',
      ),
    ).toMatchObject({
      ok: false,
      code: 'forbidden_sender',
    });
    expect(h.engine.recallForDraft).not.toHaveBeenCalled();
  });

  it('never echoes raw errors', async () => {
    const h = await openPaired();
    h.engine.recallForDraft.mockRejectedValueOnce(new Error('relayer said: secret 0xdeadbeef'));
    const res = await h.worker.route(
      { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for friday' },
      contentSender(),
      'internal',
    );
    expect(res).toEqual({
      ok: false,
      code: 'internal',
      message: expect.not.stringContaining('deadbeef'),
    });
  });

  it('serves recall to content scripts and rate limits per tab', async () => {
    const h = await openPaired();
    const first = await h.worker.route(
      { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for friday' },
      contentSender(),
      'internal',
    );
    expect(first).toMatchObject({
      ok: true,
      data: { suggestions: [{ text: 'Vegetarian' }, { text: 'Allergic to cashews' }] },
    });
    const second = await h.worker.route(
      { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for saturday' },
      contentSender(),
      'internal',
    );
    expect(second).toMatchObject({ ok: false, code: 'cooling_down' });
    h.clock.t += 601;
    expect(
      (
        await h.worker.route(
          { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for friday' },
          contentSender(),
          'internal',
        )
      ).ok,
    ).toBe(true);
    expect(h.engine.recallForDraft).toHaveBeenCalledTimes(1);
  });

  it('returns not_paired before pairing and locked before opening', async () => {
    const h = harness();
    expect(
      await h.worker.route(
        { type: 'memory.recall', query: 'x', limit: 3 },
        panelSender,
        'internal',
      ),
    ).toMatchObject({ ok: false, code: 'locked' });
    await h.worker.route(
      { type: 'unlock', passphrase: 'correct horse battery staple' },
      panelSender,
      'internal',
    );
    expect(
      await h.worker.route(
        { type: 'memory.recall', query: 'x', limit: 3 },
        panelSender,
        'internal',
      ),
    ).toMatchObject({ ok: false, code: 'not_paired' });
  });

  it('lets the web app enqueue imports and drops always-blocked categories', async () => {
    const h = await openPaired();
    const base = {
      text: 'Lives in Pune',
      type: 'identity',
      receipts: [
        {
          vendor: 'chatgpt',
          conversationIdHash: 'abcdefgh',
          messageAt: '2026-10-12T10:00:00Z',
          quote: 'I live in Pune',
          quoteHash: 'abcdefgh',
          confidence: 0.9,
        },
      ],
      flags: [],
    };
    const res = await h.worker.route(
      {
        type: 'import.enqueue',
        facts: [
          { ...base, id: '00000000-0000-4000-8000-000000000001', sensitive: [] },
          { ...base, id: '00000000-0000-4000-8000-000000000002', sensitive: ['card_number'] },
        ],
      },
      webSender,
      'external',
    );
    expect(res).toEqual({ ok: true, data: { queued: 1, dropped: 1 } });
    expect(h.imports.enqueued.map((f) => f.id)).toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('validates settings patches strictly', async () => {
    const h = harness();
    expect(
      await h.worker.route(
        { type: 'settings.set', patch: { autoLockMinutes: 7 } },
        panelSender,
        'internal',
      ),
    ).toMatchObject({ ok: false, code: 'invalid_message' });
    expect(
      await h.worker.route(
        { type: 'settings.set', patch: { sensitiveAllowed: ['password'] } },
        panelSender,
        'internal',
      ),
    ).toMatchObject({ ok: false, code: 'invalid_message' });
    const ok = await h.worker.route(
      { type: 'settings.set', patch: { sites: { claude: { auto: true } }, autoLockMinutes: 15 } },
      panelSender,
      'internal',
    );
    expect(ok).toMatchObject({
      ok: true,
      data: {
        autoLockMinutes: 15,
        sites: { claude: { auto: true, capture: true }, chatgpt: { auto: false } },
      },
    });
  });

  it('wipes local data from the side panel with the typed phrase', async () => {
    const h = await openPaired();
    const res = await h.worker.route(
      { type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' },
      panelSender,
      'internal',
    );
    expect(res).toMatchObject({ ok: true, data: { lock: 'uninitialized', account: null } });
    expect(h.local.data.size).toBe(0);
    expect(h.session.data.size).toBe(0);
    expect(h.wiped.count).toBe(1);
    expect(h.engine.destroyed).toBe(true);
    expect(
      await h.worker.route({ type: 'data.wipe', confirm: 'delete' }, panelSender, 'internal'),
    ).toMatchObject({ code: 'invalid_message' });
  });

  it('confirms pairing account id format in the schema', async () => {
    const h = harness();
    expect(
      await h.worker.route(
        { type: 'pairing.confirm', accountId: ACCOUNT_ID.toUpperCase() },
        webSender,
        'external',
      ),
    ).toMatchObject({ code: 'invalid_message' });
  });
});
