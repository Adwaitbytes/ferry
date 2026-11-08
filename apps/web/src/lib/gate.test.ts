import { parseSiwsMessage } from '@ferry/pay/siws';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const GATE = 'https://gate.example';
const ADDRESS = `0x${'ab'.repeat(32)}`;
type Gate = typeof import('./gate');
let gate: Gate;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_GATE_URL', `${GATE}/`);
  gate = await import('./gate');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => responses.shift() ?? reply(500, { error: 'internal' }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const nonce = { nonce: 'AAAAAAAAAAAAAAAAAAAAAA', expiresAt: '2026-11-09T12:10:00.000Z', domain: 'ferry.example' };
const session = { token: 'v1.claims.mac', address: ADDRESS, expiresAt: '2026-11-09T16:00:00.000Z' };

describe('signInToGate', () => {
  it('signs the exact SIWS text the Gate verifies and returns the session', async () => {
    const fetchMock = stubFetch(reply(200, nonce), reply(200, session));
    const sign = vi.fn(async (_message: Uint8Array) => ({ signature: 'sig' }));
    await expect(gate.signInToGate(ADDRESS, sign, 'ferry.example')).resolves.toEqual(session);
    const signed = new TextDecoder().decode(sign.mock.calls[0]?.[0]);
    expect(parseSiwsMessage(signed)).toMatchObject({ domain: 'ferry.example', address: ADDRESS, nonce: nonce.nonce });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${GATE}/v1/auth/nonce`, `${GATE}/v1/auth/session`]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ message: signed, signature: 'sig' });
  });

  it('refuses to sign when the Gate binds sessions to another site', async () => {
    stubFetch(reply(200, { ...nonce, domain: 'evil.example' }));
    const sign = vi.fn(async (_message: Uint8Array) => ({ signature: 'sig' }));
    await expect(gate.signInToGate(ADDRESS, sign, 'ferry.example')).rejects.toMatchObject({ code: 'siws_wrong_domain' });
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('management calls', () => {
  it('sends the bearer token, no cookies, and parses the card', async () => {
    const card = {
      id: 'AAAAAAAAAAAAAAAAAAAAAA',
      name: 'Food',
      scopeLabel: 'Food',
      priceMicros: '10000',
      price: '0.01',
      currency: '0x2::usdc::USDC',
      recipient: ADDRESS,
      dailyCap: 100,
      allowedAgents: [],
      enabled: true,
      killed: false,
      createdAt: '2026-11-09T12:00:00.000Z',
    };
    const fetchMock = stubFetch(reply(201, card));
    await expect(gate.createCard('tok', { name: 'Food', scopeLabel: 'Food', priceMicros: '10000', dailyCap: 100, allowedAgents: [] })).resolves.toEqual(card);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { authorization: 'Bearer tok' } });
  });

  it('maps Gate error codes to readable errors with the status', async () => {
    stubFetch(reply(403, { error: 'forbidden' }));
    await expect(gate.listCards('tok')).rejects.toMatchObject({ status: 403, code: 'forbidden', message: expect.stringContaining('Public profile') });
    stubFetch(reply(200, { cards: [{ id: 'nope' }] }));
    await expect(gate.listCards('tok')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reports an unreachable Gate without throwing raw network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(gate.getGateProfile()).rejects.toMatchObject({ code: 'unreachable' });
  });
});
