import { afterEach, describe, expect, it } from 'vitest';
import { GateCardList, GateEarnings, GateNonce, GateOwnerCard, GateProfile, GateRecallResult, GateSession } from '@ferry/core';
import { MAINNET_USDC_TYPE, siwsMessage } from '@ferry/pay';
import { CARD_ID, DIGEST, OWNER, PAYER, TESTNET_USDC_TYPE, WEB_ORIGIN, credentialFor, harness, ownerKey, paidTx, strangerKey, type Harness } from './harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.db.close();
  h = undefined;
});

const base = 'https://gate.test';
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.1', ...headers }, body: JSON.stringify(body) });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${base}${path}`, { headers: { 'x-real-ip': '203.0.113.1', ...headers } });

describe('Gate public routes', () => {
  it('serves health and public card metadata with security headers', async () => {
    h = await harness();
    const health = await h.app.request(get('/health'));
    expect(await health.json()).toEqual({ ok: true, service: 'ferry-gate', network: 'mainnet' });
    const res = await h.app.request(get(`/v1/cards/${CARD_ID}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: CARD_ID, name: 'Food', price: '0.01', priceMicros: '10000', recipient: OWNER, network: 'mainnet', currency: MAINNET_USDC_TYPE });
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('RT-53 malformed and injected card ids get 400 with no database query', async () => {
    h = await harness();
    for (const id of ['1', encodeURIComponent("' OR 1=1--"), 'q3V7mT0xR9bK2wY5pL8nA', 'q3V7mT0xR9bK2wY5pL8nAg%00', '..%2Fadmin']) {
      const res = await h.app.request(get(`/v1/cards/${id}/recall?q=food`));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_card_id' });
    }
    expect(h.statements).toEqual([]);
  });

  it('RT-54 unknown, killed and disabled cards return byte-identical 404s and no challenge', async () => {
    h = await harness();
    await h.store.createCard({ id: 'Zr8kP1vN4cT7wQ2mX5yB0a', ownerAddress: OWNER, publicAccountId: `0x${'ee'.repeat(32)}`, name: 'Off', scopeLabel: 'Off', priceMicros: 10_000n, dailyCap: 5, allowedAgents: [] });
    await h.store.updateCard('Zr8kP1vN4cT7wQ2mX5yB0a', OWNER, { enabled: false });
    const unknown = await h.app.request(get('/v1/cards/AAAAAAAAAAAAAAAAAAAAAA/recall?q=food'));
    const disabled = await h.app.request(get('/v1/cards/Zr8kP1vN4cT7wQ2mX5yB0a/recall?q=food'));
    await h.store.killCard(CARD_ID, OWNER);
    const killed = await h.app.request(get(`/v1/cards/${CARD_ID}/recall?q=food`));
    const bodies = await Promise.all([unknown, disabled, killed].map((r) => r.text()));
    expect(new Set(bodies)).toEqual(new Set(['{"error":"not_found"}']));
    for (const res of [unknown, disabled, killed]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('www-authenticate')).toBeNull();
    }
  });

  it('RT-55 404 flood from one IP gets 429 with Retry-After, another IP does not', async () => {
    h = await harness();
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const id = 'A'.repeat(20) + String(i).padStart(2, '0').replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'a');
      const res = await h.app.request(get(`/v1/cards/${id}`, { 'x-real-ip': '203.0.113.7' }));
      statuses.push(res.status);
      if (i === 24) expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
    expect((await h.app.request(get('/v1/cards/AAAAAAAAAAAAAAAAAAAAAA', { 'x-real-ip': '198.51.100.9' }))).status).toBe(404);
  });

  it('answers unpaid recall with 402, an MPP challenge and x402 terms; validates q first', async () => {
    h = await harness();
    const res = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food preferences' }));
    expect(res.status).toBe(402);
    expect(res.headers.get('www-authenticate')).toMatch(/^Payment /);
    expect(await res.json()).toMatchObject({ error: 'payment_required', x402Version: 1, mpp: { amountMicros: '10000', recipient: OWNER } });
    expect((await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: '' }))).status).toBe(400);
    expect((await h.app.request(get(`/v1/cards/${CARD_ID}/recall`))).status).toBe(400);
    const notJson = new Request(`${base}/v1/cards/${CARD_ID}/recall`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'q=food' });
    expect((await h.app.request(notJson)).status).toBe(400);
  });

  it('refuses to issue a challenge once the daily cap is reached', async () => {
    h = await harness();
    await h.store.updateCard(CARD_ID, OWNER, { dailyCap: 1 });
    await h.store.incrementDaily(CARD_ID, Date.now());
    const res = await h.app.request(get(`/v1/cards/${CARD_ID}/recall?q=food`));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'daily_cap' });
  });
});

describe('Gate paid recall', () => {
  async function paidRequest(harnessed: Harness, q = 'food preferences') {
    const challenge = await harnessed.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q }));
    harnessed.chain.tx = paidTx();
    const credential = await credentialFor(challenge);
    return () => post(`/v1/cards/${CARD_ID}/recall`, { q }, { Authorization: credential });
  }

  it('serves a GateRecallResult with a receipt once, then 409s the replay without recalling', async () => {
    h = await harness();
    const request = await paidRequest(h);
    const res = await h.app.request(request());
    expect(res.status).toBe(200);
    const body = GateRecallResult.parse(await res.json());
    expect(body.payment).toMatchObject({ amountMicros: '10000', payer: PAYER });
    expect(body.results[0]?.text).toContain('cashews');
    expect(res.headers.get('payment-receipt')).toBeTruthy();
    const replay = await h.app.request(request());
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'payment_replayed' });
    expect(h.recallCalls).toHaveLength(1);
  });

  it('RT-41 ten concurrent requests with one credential recall exactly once', async () => {
    h = await harness();
    const request = await paidRequest(h);
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => h?.app.request(request())))).map((r) => r?.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(h.recallCalls).toHaveLength(1);
  });

  it('returns the receipt when recall fails after payment, and never logs the query', async () => {
    h = await harness();
    const marker = 'FERRYLEAKMARKER7f3a9c';
    h.recallFails.value = true;
    const res = await h.app.request((await paidRequest(h, `my ${marker} food`))());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'recall_unavailable', receiptId: expect.stringMatching(/^rcpt_/) });
    expect(h.logs.join('\n')).not.toContain(marker);
    expect(h.logs.some((line) => line.includes('"receiptId":"rcpt_'))).toBe(true);
  });

  it('maps verification failures to their statuses', async () => {
    h = await harness();
    const request = await paidRequest(h);
    h.chain.tx = { ...paidTx(), checkpoint: null };
    const res = await h.app.request(request());
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'payment_pending' });
  });
});

describe('Gate card management and earnings', () => {
  async function login(harnessed: Harness, key = ownerKey) {
    const { nonce } = GateNonce.parse(await (await harnessed.app.request(post('/v1/auth/nonce', {}))).json());
    const now = Date.now();
    const message = siwsMessage({ domain: new URL(WEB_ORIGIN).host, address: key.toSuiAddress(), nonce, issuedAt: new Date(now).toISOString(), expiry: new Date(now + 3_600_000).toISOString() });
    const { signature } = await key.signPersonalMessage(new TextEncoder().encode(message));
    const res = await harnessed.app.request(post('/v1/auth/session', { message, signature }));
    expect(res.status).toBe(200);
    return { Authorization: `Bearer ${GateSession.parse(await res.json()).token}`, message, signature };
  }

  it('creates, updates and kills a card only with the owner session', async () => {
    h = await harness();
    expect((await h.app.request(post('/v1/manage/cards', { name: 'Travel', scopeLabel: 'Travel' }))).status).toBe(401);
    const stranger = await login(h, strangerKey);
    expect((await h.app.request(post('/v1/manage/cards', { name: 'Travel', scopeLabel: 'Travel' }, { Authorization: stranger.Authorization }))).status).toBe(403);
    const owner = await login(h);
    const auth = { Authorization: owner.Authorization };
    expect((await h.app.request(post('/v1/manage/cards', { name: '<b>', scopeLabel: 'x' }, auth))).status).toBe(400);
    const created = await h.app.request(post('/v1/manage/cards', { name: 'Travel', scopeLabel: 'Travel', priceMicros: '20000', allowedAgents: [PAYER] }, auth));
    expect(created.status).toBe(201);
    const card = GateOwnerCard.parse(await created.json());
    expect(card).toMatchObject({ price: '0.02', allowedAgents: [PAYER] });

    const patch = (id: string, body: unknown, headers = auth) =>
      new Request(`${base}/v1/manage/cards/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect(await (await h.app.request(patch(card.id, { dailyCap: 7, allowedAgents: [] }))).json()).toMatchObject({ dailyCap: 7, allowedAgents: [] });
    expect((await h.app.request(patch(card.id, { dailyCap: 7 }, { Authorization: stranger.Authorization }))).status).toBe(404);
    expect((await h.app.request(patch('bad', {}))).status).toBe(400);
    expect((await h.app.request(patch(card.id, { killed: false }))).status).toBe(400);
    const listed = await h.app.request(new Request(`${base}/v1/manage/cards`, { headers: auth }));
    expect(GateCardList.parse(await listed.json()).cards.map((c) => c.id)).toContain(card.id);
    expect((await h.app.request(post(`/v1/manage/cards/${card.id}/kill`, {}, { Authorization: stranger.Authorization }))).status).toBe(404);
    expect(await (await h.app.request(post(`/v1/manage/cards/${card.id}/kill`, {}, auth))).json()).toEqual({ id: card.id, killed: true });
    expect((await h.app.request(post('/v1/manage/cards/bad/kill', {}, auth))).status).toBe(400);
    expect((await h.app.request(new Request(`${base}/v1/manage/cards`))).status).toBe(401);
    expect((await h.app.request(new Request(`${base}/v1/manage/cards/${card.id}/kill`, { method: 'POST' }))).status).toBe(401);
    expect((await h.app.request(patch(card.id, {}, {} as typeof auth))).status).toBe(401);
  });

  it('publishes the Public profile owner so the web app can gate card creation honestly', async () => {
    h = await harness();
    const res = await h.app.request(get('/v1/profile', { Origin: WEB_ORIGIN }));
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(GateProfile.parse(await res.json())).toMatchObject({ owner: OWNER, namespace: 'ferry-public' });
  });

  it('rejects a reused SIWS signature and malformed session requests', async () => {
    h = await harness();
    const owner = await login(h);
    const replay = await h.app.request(post('/v1/auth/session', { message: owner.message, signature: owner.signature }));
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: 'siws_nonce_used' });
    expect((await h.app.request(post('/v1/auth/session', { message: 1 }))).status).toBe(400);
  });

  it('shows earnings only to the owner, with totals and explorer links', async () => {
    h = await harness({ usdcUsdPrice: async () => ({ usd: '0.9998' }) });
    const challenge = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }));
    h.chain.tx = paidTx();
    await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }, { Authorization: await credentialFor(challenge) }));
    const owner = await login(h);
    const res = await h.app.request(get(`/v1/earnings?owner=${OWNER}`, { Authorization: owner.Authorization, Origin: WEB_ORIGIN }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const body = GateEarnings.parse(await res.json());
    expect(body.totals).toMatchObject({ total: '0.01', count: 1, usdcUsd: '0.9998', totalUsd: '0.00' });
    expect(body.payments[0]).toMatchObject({ agent: PAYER, explorerUrl: expect.stringContaining('suiscan.xyz/mainnet/tx/') });
    expect(body.payments[0]?.querySha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await h.app.request(get(`/v1/earnings?owner=${PAYER}`, { Authorization: owner.Authorization }))).status).toBe(403);
    expect((await h.app.request(get(`/v1/earnings?owner=${OWNER}`))).status).toBe(401);
    expect((await h.app.request(get('/v1/earnings?owner=nope'))).status).toBe(400);
  });
});

describe('Gate hygiene', () => {
  it('returns JSON 404 for unknown routes, 413 for large bodies and 500 without leaking errors', async () => {
    h = await harness();
    expect(await (await h.app.request(get('/nope'))).text()).toBe('{"error":"not_found"}');
    const big = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'x'.repeat(20_000) }));
    expect(big.status).toBe(413);
    await h.db.close();
    const broken = await h.app.request(get(`/v1/cards/${CARD_ID}`));
    expect(broken.status).toBe(500);
    expect(await broken.text()).toBe('{"error":"internal"}');
    expect(h.logs.at(-1)).toMatch(/"code":"internal:/);
    h = undefined;
  });

  it('rate limits auth nonces per IP', async () => {
    h = await harness();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await h.app.request(post('/v1/auth/nonce', {}, { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).status;
    expect(last).toBe(429);
  });
});

describe('microsToUsd', () => {
  it('converts with bigint math and rejects odd rates', async () => {
    const { microsToUsd } = await import('../src/app.js');
    expect(microsToUsd(12_340_000n, '1')).toBe('12.34');
    expect(microsToUsd(10_000n, '1.0001')).toBe('0.01');
    expect(microsToUsd(1n, 'NaN')).toBeNull();
  });

  it('renders earnings without fiat when the price feed fails', async () => {
    h = await harness({ usdcUsdPrice: async () => Promise.reject(new Error('401')) });
    const { nonce } = (await (await h.app.request(post('/v1/auth/nonce', {}))).json()) as { nonce: string };
    const now = Date.now();
    const message = siwsMessage({ domain: new URL(WEB_ORIGIN).host, address: OWNER, nonce, issuedAt: new Date(now).toISOString(), expiry: new Date(now + 60_000).toISOString() });
    const { signature } = await ownerKey.signPersonalMessage(new TextEncoder().encode(message));
    const { token } = (await (await h.app.request(post('/v1/auth/session', { message, signature }))).json()) as { token: string };
    const res = await h.app.request(get(`/v1/earnings?owner=${OWNER}`, { Authorization: `Bearer ${token}` }));
    expect(await res.json()).toMatchObject({ totals: { usdcUsd: null, totalUsd: null } });
  });
});

describe('Gate on the testnet payment network', () => {
  async function testnetLogin(harnessed: Harness) {
    const { nonce } = GateNonce.parse(await (await harnessed.app.request(post('/v1/auth/nonce', {}))).json());
    const now = Date.now();
    const message = siwsMessage({ domain: new URL(WEB_ORIGIN).host, address: OWNER, nonce, issuedAt: new Date(now).toISOString(), expiry: new Date(now + 3_600_000).toISOString() });
    const { signature } = await ownerKey.signPersonalMessage(new TextEncoder().encode(message));
    return `Bearer ${GateSession.parse(await (await harnessed.app.request(post('/v1/auth/session', { message, signature }))).json()).token}`;
  }

  it('labels health, card and 402 with testnet and Testnet USDC', async () => {
    h = await harness({ network: 'testnet' });
    expect(await (await h.app.request(get('/health'))).json()).toEqual({ ok: true, service: 'ferry-gate', network: 'testnet' });
    expect(await (await h.app.request(get(`/v1/cards/${CARD_ID}`))).json()).toMatchObject({ network: 'testnet', currency: TESTNET_USDC_TYPE });
    const challenge = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }));
    expect(await challenge.json()).toMatchObject({ mpp: { currency: TESTNET_USDC_TYPE } });
  });

  it('serves a Testnet USDC payment and links earnings to the testnet explorer', async () => {
    h = await harness({ network: 'testnet' });
    const challenge = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }));
    h.chain.tx = paidTx(Date.now(), TESTNET_USDC_TYPE);
    const paid = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }, { Authorization: await credentialFor(challenge, 'testnet') }));
    expect(paid.status).toBe(200);
    const res = await h.app.request(get(`/v1/earnings?owner=${OWNER}`, { Authorization: await testnetLogin(h) }));
    const body = GateEarnings.parse(await res.json());
    expect(body.currency).toBe(TESTNET_USDC_TYPE);
    expect(body.payments[0]?.explorerUrl).toBe(`https://suiscan.xyz/testnet/tx/${DIGEST}`);
  });

  it('refuses Mainnet USDC on a testnet Gate and Testnet USDC on a mainnet Gate as wrong coin', async () => {
    for (const [network, coin] of [
      ['testnet', MAINNET_USDC_TYPE],
      ['mainnet', TESTNET_USDC_TYPE],
    ] as const) {
      await h?.db.close();
      h = await harness({ network });
      const challenge = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }));
      h.chain.tx = paidTx(Date.now(), coin);
      const res = await h.app.request(post(`/v1/cards/${CARD_ID}/recall`, { q: 'food' }, { Authorization: await credentialFor(challenge, network) }));
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: 'payment_wrong_coin' });
      expect(h.recallCalls).toHaveLength(0);
    }
  });
});
