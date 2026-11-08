import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { ChainDataError, MissingApiKeyError, RateLimitedError, type ChainService } from '@ferry/chain';

const getChainService = vi.fn<() => ChainService>();
vi.mock('@ferry/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ferry/chain')>()),
  getChainService: () => getChainService(),
}));

const { chainRoute, corsOrigin, preflight } = await import('./http');
const { BlobParam, ObjectIdParam } = await import('./params');

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const chain = {} as ChainService;

function req(headers: Record<string, string> = {}, ip = '203.0.113.1') {
  return new NextRequest('https://ferry.example/api/chain/epoch', { headers: { 'x-real-ip': ip, ...headers } });
}

beforeEach(() => {
  vi.stubEnv('FERRY_EXTENSION_IDS', `${EXT}, not-an-id`);
  getChainService.mockReturnValue(chain);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('chain proxy CORS', () => {
  it('allows same origin, listed extensions and no-origin requests only', () => {
    expect(corsOrigin(req({ origin: 'https://ferry.example' }))).toEqual({ allowed: true, origin: 'https://ferry.example' });
    expect(corsOrigin(req({ origin: `chrome-extension://${EXT}` })).allowed).toBe(true);
    expect(corsOrigin(req())).toEqual({ allowed: true, origin: null });
    expect(corsOrigin(req({ origin: 'chrome-extension://not-an-id' })).allowed).toBe(false);
    expect(corsOrigin(req({ origin: 'https://ferry.example.evil.test' })).allowed).toBe(false);
  });

  it('answers preflight only for allowed origins', () => {
    const ok = preflight(req({ origin: `chrome-extension://${EXT}` }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(`chrome-extension://${EXT}`);
    const denied = preflight(req({ origin: 'https://evil.test' }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('chainRoute', () => {
  it('returns JSON with CORS for an allowed extension and logs only route, status and timing', async () => {
    const res = await chainRoute(req({ origin: `chrome-extension://${EXT}` }, '198.51.100.7'), 'epoch', async () => ({ walrus: 43 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ walrus: 43 });
    expect(res.headers.get('access-control-allow-origin')).toBe(`chrome-extension://${EXT}`);
    const line = JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(['at', 'ms', 'route', 'status']);
    expect(line).toMatchObject({ route: 'epoch', status: 200 });
  });

  it('refuses foreign origins before touching the chain', async () => {
    const read = vi.fn();
    const res = await chainRoute(req({ origin: 'https://evil.test' }), 'epoch', read);
    expect(res.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it('maps null to 404 and errors to fixed bodies with no upstream text', async () => {
    const cases: [unknown, number, string][] = [
      [new ZodError([]), 400, 'invalid_request'],
      [new MissingApiKeyError(), 503, 'unavailable'],
      [new RateLimitedError(2500), 503, 'busy'],
      [new ChainDataError('object is not a MemWalAccount'), 422, 'unexpected_object'],
      [new Error('x-api-key=secret leaked'), 502, 'upstream'],
    ];
    expect((await chainRoute(req({}, '192.0.2.50'), 'account', async () => null)).status).toBe(404);
    for (const [error, status, code] of cases) {
      const res = await chainRoute(req({}, '192.0.2.51'), 'account', async () => Promise.reject(error));
      expect(res.status).toBe(status);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: code });
      expect(text).not.toContain('secret');
    }
  });

  it('rate limits per IP with Retry-After', async () => {
    const ip = '192.0.2.99';
    for (let i = 0; i < 20; i += 1) expect((await chainRoute(req({}, ip), 'meter', async () => ({}))).status).toBe(200);
    const limited = await chainRoute(req({}, ip), 'meter', async () => ({}));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await chainRoute(req({}, '192.0.2.100'), 'meter', async () => ({}))).status).toBe(200);
  });
});

describe('route params', () => {
  it('accepts object ids case-insensitively and Walrus blob ids', () => {
    expect(ObjectIdParam.parse(`0x${'AB'.repeat(32)}`)).toBe(`0x${'ab'.repeat(32)}`);
    expect(() => ObjectIdParam.parse('0xzz')).toThrow();
    expect(BlobParam.parse('FD0xEmwi1dm9NjAo2oMDJix74t8NZb3tlhQMu0jz2KY')).toBe('FD0xEmwi1dm9NjAo2oMDJix74t8NZb3tlhQMu0jz2KY');
    expect(() => BlobParam.parse('../../etc')).toThrow();
  });
});
