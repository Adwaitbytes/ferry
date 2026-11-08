import { createHash } from 'node:crypto';
import { WebAppResponse, type WebAppRequest } from '@ferry/core';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_ID,
  EXTENSION_PUBLIC_KEY,
  LOCAL_WEB_ORIGIN,
  buildManifest,
  resolveOrigins,
} from '../manifest.config';
import { classifyExternal } from '../src/worker/senders';
import { harness, openPaired, panelSender, webSender } from './helpers';

const FACT = {
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
} as const;

const REQUESTS: WebAppRequest[] = [
  { type: 'status.get' },
  { type: 'pairing.begin' },
  { type: 'import.enqueue', facts: [{ ...FACT, receipts: [...FACT.receipts], sensitive: [], flags: [] }] },
  { type: 'import.progress' },
  { type: 'memory.list' },
  { type: 'memory.recall', query: 'dinner', limit: 5 },
  { type: 'memory.save', fact: { ...FACT, receipts: [...FACT.receipts], sensitive: [], flags: [] } },
  { type: 'memory.hide', ref: 'blob-aaaaaaaa1' },
  { type: 'memory.resolve', conflictId: FACT.id, resolution: { kind: 'keep_old' } },
  { type: 'data.export' },
];

describe('web app responses match the frozen core schemas', () => {
  it.each(REQUESTS.map((r) => [r.type, r] as const))('%s', async (_type, request) => {
    const h = await openPaired();
    const res = await h.worker.route(request, webSender, 'external');
    if (!res.ok) throw new Error(`${request.type} failed: ${res.code}`);
    expect(WebAppResponse[request.type].safeParse(res.data).success).toBe(true);
  });

  it('returns recall as a bare suggestion array', async () => {
    const h = await openPaired();
    const res = await h.worker.route(
      { type: 'memory.recall', query: 'dinner', limit: 5 },
      webSender,
      'external',
    );
    expect(res.ok && Array.isArray(res.data)).toBe(true);
  });

  it('keeps adapter health and unsaved captures out of the web app status', async () => {
    const h = await openPaired();
    const web = await h.worker.route({ type: 'status.get' }, webSender, 'external');
    const panel = await h.worker.route({ type: 'status.get' }, panelSender, 'internal');
    expect(web.ok && panel.ok).toBe(true);
    if (!web.ok || !panel.ok) return;
    expect(web.data).not.toHaveProperty('recentCaptures');
    expect(web.data).not.toHaveProperty('adapters');
    expect(panel.data).toHaveProperty('recentCaptures');
    expect(web.data).toMatchObject({ locked: false, paired: true, governor: { kind: 'ready' } });
  });

  it('reports a governor cooldown in status', async () => {
    const h = harness();
    await openPaired(h);
    h.engine.governor = () => ({ kind: 'cooling_down', reason: 'rate_limited', resumeAt: 99 });
    const res = await h.worker.route({ type: 'status.get' }, webSender, 'external');
    expect(res).toMatchObject({ ok: true, data: { governor: { kind: 'cooling_down' } } });
  });

  it('fails closed with internal when the engine returns a drifted shape', async () => {
    const h = await openPaired();
    h.engine.list = async () => ({ items: [{ wrong: true }], nextCursor: null }) as never;
    const res = await h.worker.route({ type: 'memory.list' }, webSender, 'external');
    expect(res).toMatchObject({ ok: false, code: 'internal' });
  });
});

describe('stable id and dual web origins', () => {
  it('pins the manifest key whose hash is the published extension id', () => {
    const der = Buffer.from(EXTENSION_PUBLIC_KEY, 'base64');
    const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
      .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
      .join('');
    expect(id).toBe(EXTENSION_ID);
    expect(buildManifest(resolveOrigins({})).key).toBe(EXTENSION_PUBLIC_KEY);
  });

  it('defaults the API to production when a production origin is configured', () => {
    expect(resolveOrigins({})).toEqual({ api: LOCAL_WEB_ORIGIN, web: [LOCAL_WEB_ORIGIN] });
    expect(resolveOrigins({ FERRY_WEB_ORIGIN_PROD: 'https://ferry.example' })).toEqual({
      api: 'https://ferry.example',
      web: ['https://ferry.example', LOCAL_WEB_ORIGIN],
    });
  });

  it('accepts both web origins and nothing else', () => {
    const allowed = ['https://ferry.example', LOCAL_WEB_ORIGIN];
    expect(classifyExternal({ origin: LOCAL_WEB_ORIGIN }, allowed).kind).toBe('web_app');
    expect(classifyExternal({ origin: 'https://ferry.example' }, allowed).kind).toBe('web_app');
    expect(classifyExternal({ origin: 'http://localhost:3001' }, allowed).kind).toBe('forbidden');
    expect(
      classifyExternal({ origin: LOCAL_WEB_ORIGIN, url: 'https://ferry.example/x' }, allowed).kind,
    ).toBe('forbidden');
  });
});
