/* eslint-disable security/detect-non-literal-fs-filename -- paths are this package's fixed build output, never user input */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXT_ID,
  FERRY_WEB_ORIGIN,
  contentSender,
  harness,
  openPaired,
  panelSender,
} from '../helpers';

const OUT = fileURLToPath(new URL('../../.output/chrome-mv3/', import.meta.url));
const recall = { type: 'recall.suggest', site: 'claude', draft: 'dinner plans for friday' };

describe('forged extension messages', () => {
  it('RT-32 message from another extension is forbidden and never reaches the relayer', async () => {
    const h = await openPaired();
    const res = await h.worker.route(
      recall,
      {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        tab: { id: 4, url: 'https://claude.ai/new' },
        frameId: 0,
      },
      'internal',
    );
    expect(res).toMatchObject({ ok: false, code: 'forbidden_sender' });
    expect(h.engine.recallForDraft).not.toHaveBeenCalled();
  });

  it('RT-33 lookalike host in sender tab URL is forbidden', async () => {
    const h = await openPaired();
    const msg = { type: 'capture.propose', site: 'chatgpt', userText: 'I am vegetarian' };
    for (const url of [
      'https://chatgpt.com.evil.example/c/1',
      'http://chatgpt.com/c/1',
      'https://evil.example/?u=https://chatgpt.com',
    ]) {
      expect(
        await h.worker.route(msg, { id: EXT_ID, tab: { id: 4, url }, frameId: 0 }, 'internal'),
      ).toMatchObject({ ok: false, code: 'forbidden_sender' });
    }
    expect(h.api.distillMessage).not.toHaveBeenCalled();
  });

  it('RT-34 external message from a non-Ferry origin is forbidden; the Ferry origin is served', async () => {
    const h = await openPaired();
    const msg = { type: 'pairing.begin' };
    for (const sender of [
      {
        origin: 'https://ferry.example.evil.example',
        url: 'https://ferry.example.evil.example/pair',
      },
      { origin: 'http://ferry.example', url: 'http://ferry.example/pair' },
      { origin: 'https://evil.example', url: 'https://evil.example/' },
    ]) {
      expect(await h.worker.route(msg, sender, 'external')).toMatchObject({
        ok: false,
        code: 'forbidden_sender',
      });
    }
    expect(
      await h.worker.route(
        msg,
        { origin: FERRY_WEB_ORIGIN, url: `${FERRY_WEB_ORIGIN}/pair` },
        'external',
      ),
    ).toMatchObject({ ok: true });
  });

  it('RT-35 unknown message type requesting key material is invalid, and no response carries the seed', async () => {
    const h = await openPaired();
    expect(
      await h.worker.route({ type: 'exportDelegateKey' }, panelSender, 'internal'),
    ).toMatchObject({ ok: false, code: 'invalid_message' });
    const seedHex = '07'.repeat(32);
    for (const type of [
      'status.get',
      'pairing.begin',
      'settings.get',
      'import.progress',
      'data.export',
    ]) {
      const res = await h.worker.route({ type }, panelSender, 'internal');
      expect(JSON.stringify(res)).not.toContain(seedHex);
    }
  });

  it('RT-36 prototype pollution and extra keys are rejected by the strict check', async () => {
    const h = await openPaired();
    const msg: unknown = JSON.parse(
      '{"type":"recall.suggest","site":"claude","draft":"x","__proto__":{"isPrivileged":true},"limit":100000}',
    );
    expect(await h.worker.route(msg, contentSender(), 'internal')).toMatchObject({
      ok: false,
      code: 'invalid_message',
    });
    expect(({} as Record<string, unknown>).isPrivileged).toBeUndefined();
    const nested: unknown = JSON.parse(
      '{"type":"memory.recall","query":"x","limit":3,"extra":{"a":1}}',
    );
    expect(await h.worker.route(nested, panelSender, 'internal')).toMatchObject({
      ok: false,
      code: 'invalid_message',
    });
  });

  it('RT-37 privileged action from a content script is forbidden; the side panel passes routing', async () => {
    const h = await openPaired();
    const msg = { type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' };
    expect(
      await h.worker.route(
        msg,
        { id: EXT_ID, tab: { id: 4, url: 'https://chatgpt.com/' }, frameId: 0 },
        'internal',
      ),
    ).toMatchObject({
      ok: false,
      code: 'forbidden_sender',
    });
    expect(h.wiped.count).toBe(0);
    expect(
      await h.worker.route(
        msg,
        { id: EXT_ID, url: `chrome-extension://${EXT_ID}/sidepanel.html` },
        'internal',
      ),
    ).toMatchObject({ ok: true });
    expect(h.wiped.count).toBe(1);
  });

  it('RT-38 message from a subframe inside a supported site is forbidden', async () => {
    const h = harness();
    const msg = { type: 'capture.propose', site: 'gemini', userText: 'I prefer aisle seats' };
    expect(
      await h.worker.route(
        msg,
        {
          id: EXT_ID,
          tab: { id: 9, url: 'https://gemini.google.com/app' },
          frameId: 3,
          url: 'https://ads.example/frame.html',
        },
        'internal',
      ),
    ).toMatchObject({
      ok: false,
      code: 'forbidden_sender',
    });
  });

  it.runIf(existsSync(`${OUT}manifest.json`))(
    'RT-38 built manifest runs every content script in the top frame only',
    () => {
      const manifest = JSON.parse(readFileSync(`${OUT}manifest.json`, 'utf8')) as {
        content_scripts: Array<{ all_frames?: boolean }>;
      };
      expect(manifest.content_scripts.length).toBe(3);
      for (const cs of manifest.content_scripts) expect(cs.all_frames ?? false).toBe(false);
    },
  );

  it.runIf(existsSync(`${OUT}manifest.json`))(
    'RT-39 built content scripts never post or listen to window messages',
    () => {
      for (const site of ['chatgpt', 'claude', 'gemini']) {
        const js = readFileSync(`${OUT}content-${site}.js`, 'utf8');
        expect(js).not.toMatch(/addEventListener\(\s*["'`]message["'`]/);
        expect(js).not.toContain('.postMessage(');
      }
    },
  );
});
