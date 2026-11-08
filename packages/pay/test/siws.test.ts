import type { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { issueNonce, parseSiwsMessage, signSession, siwsMessage, verifySession, verifySiws } from '../src/siws.js';
import { PAYER, attackerKey, payerKey, setup } from './fixtures.js';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

const DOMAIN = 'ferry.example';
const SECRET = 's'.repeat(40);

async function signedRequest(over: Partial<{ domain: string; issuedAtMs: number; expiryMs: number; nonce: string; key: typeof payerKey }> = {}, nonce: string) {
  const now = Date.now();
  const message = siwsMessage({
    domain: over.domain ?? DOMAIN,
    address: PAYER,
    nonce: over.nonce ?? nonce,
    issuedAt: new Date(over.issuedAtMs ?? now).toISOString(),
    expiry: new Date(over.expiryMs ?? now + 3_600_000).toISOString(),
  });
  const signature = (await (over.key ?? payerKey).signPersonalMessage(new TextEncoder().encode(message))).signature;
  return { message, signature };
}

describe('SIWS sessions', () => {
  it('verifies a signed message once and burns the nonce', async () => {
    const env = await setup();
    db = env.db;
    const { nonce } = await issueNonce(env.store, Date.now());
    const request = await signedRequest({}, nonce);
    const ok = await verifySiws(request, { store: env.store, domain: DOMAIN, nowMs: Date.now() });
    expect(ok).toMatchObject({ ok: true, address: PAYER });
    expect(await verifySiws(request, { store: env.store, domain: DOMAIN, nowMs: Date.now() })).toEqual({ ok: false, reason: 'NONCE_USED' });
  });

  it('rejects wrong domain, bad signature, expired windows and edited messages', async () => {
    const env = await setup();
    db = env.db;
    const { nonce } = await issueNonce(env.store, Date.now());
    const opts = { store: env.store, domain: DOMAIN, nowMs: Date.now() };
    expect(await verifySiws(await signedRequest({ domain: 'evil.example' }, nonce), opts)).toEqual({ ok: false, reason: 'WRONG_DOMAIN' });
    expect(await verifySiws(await signedRequest({ key: attackerKey }, nonce), opts)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(await verifySiws(await signedRequest({ expiryMs: opts.nowMs - 1 }, nonce), opts)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(await verifySiws(await signedRequest({ expiryMs: Date.now() + 48 * 3_600_000 }, nonce), opts)).toEqual({ ok: false, reason: 'EXPIRED' });
    const good = await signedRequest({}, nonce);
    expect(await verifySiws({ ...good, message: `${good.message} ` }, opts)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(await verifySiws({ ...good, signature: 'garbage' }, opts)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    const badDate = siwsMessage({ domain: DOMAIN, address: PAYER, nonce, issuedAt: '2026-99-99T00:00:00.000Z', expiry: '2026-99-99T00:00:00.000Z' });
    expect(await verifySiws({ message: badDate, signature: good.signature }, opts)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(parseSiwsMessage('hello')).toBeNull();
    // The nonce survives all of these, so the honest user can still sign in.
    expect(await verifySiws(good, opts)).toMatchObject({ ok: true });
  });

  it('signs and verifies stateless session tokens', async () => {
    const nowMs = Date.now();
    const token = await signSession({ address: PAYER, domain: DOMAIN, expiresAtMs: nowMs + 1000 }, SECRET);
    expect(await verifySession(token, { secret: SECRET, domain: DOMAIN, nowMs })).toBe(PAYER);
    expect(await verifySession(token, { secret: SECRET, domain: 'other', nowMs })).toBeNull();
    expect(await verifySession(token, { secret: SECRET, domain: DOMAIN, nowMs: nowMs + 2000 })).toBeNull();
    expect(await verifySession(token, { secret: 'x'.repeat(40), domain: DOMAIN, nowMs })).toBeNull();
    const [v, body] = token.split('.');
    expect(await verifySession(`${v}.${body}.AAAA`, { secret: SECRET, domain: DOMAIN, nowMs })).toBeNull();
    expect(await verifySession('v1.a.b.c', { secret: SECRET, domain: DOMAIN, nowMs })).toBeNull();
    expect(await verifySession('v1.!!.??', { secret: SECRET, domain: DOMAIN, nowMs })).toBeNull();
    await expect(signSession({ address: PAYER, domain: DOMAIN, expiresAtMs: 1 }, 'short')).rejects.toThrow();
  });
});
