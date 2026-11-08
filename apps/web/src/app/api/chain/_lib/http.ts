import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import {
  ChainDataError,
  KeyedRateLimiter,
  MissingApiKeyError,
  RateLimitedError,
  getChainService,
  type ChainService,
} from '@ferry/chain';
import { DEFAULT_EXTENSION_ID } from '../../../../lib/env';

/**
 * Chain proxy plumbing shared by every /api/chain route (threat model section 10, X-CHP-1).
 * Responses are rebuilt from parsed data: no upstream headers, bodies or error text are ever
 * forwarded, so the Tatum key cannot leak through an error path.
 */

/**
 * Per-IP limit, in memory per serverless instance. Good enough for the hackathon; a shared
 * limiter (Upstash Redis or a Neon counter) replaces this when traffic spans many instances.
 */
const perIp = new KeyedRateLimiter({ ratePerSec: 0.5, capacity: 20, maxKeys: 10_000 });

const EXTENSION_ID = /^[a-p]{32}$/;

/** The pinned release id (manifest `key`) is always allowed; FERRY_EXTENSION_IDS adds forks. */
function allowedExtensionOrigins(): Set<string> {
  const ids = (process.env['FERRY_EXTENSION_IDS'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => EXTENSION_ID.test(id));
  return new Set([DEFAULT_EXTENSION_ID, ...ids].map((id) => `chrome-extension://${id}`));
}

/** Exact-match origin check (X-MSG-1 style): same origin, or a listed extension id. */
export function corsOrigin(request: NextRequest): { allowed: boolean; origin: string | null } {
  const origin = request.headers.get('origin');
  if (origin === null) return { allowed: true, origin: null };
  if (origin === request.nextUrl.origin || allowedExtensionOrigins().has(origin)) return { allowed: true, origin };
  return { allowed: false, origin };
}

function clientIp(request: NextRequest): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

/** One allowlisted log shape (X-LOG-1): route, status and timing. Never params, bodies or keys. */
function logLine(route: string, status: number, startedAt: number): void {
  process.stdout.write(`${JSON.stringify({ at: 'chain-proxy', route, status, ms: Math.round(performance.now() - startedAt) })}\n`);
}

function json(body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', status === 200 ? 'private, max-age=15' : 'no-store');
  response.headers.set('Vary', 'Origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  for (const [key, value] of Object.entries(extra)) response.headers.set(key, value);
  return response;
}

function failure(error: unknown): { status: number; body: { error: string }; headers?: Record<string, string> } {
  if (error instanceof ZodError || error instanceof TypeError) return { status: 400, body: { error: 'invalid_request' } };
  if (error instanceof MissingApiKeyError) return { status: 503, body: { error: 'unavailable' } };
  if (error instanceof RateLimitedError) {
    return { status: 503, body: { error: 'busy' }, headers: { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) } };
  }
  if (error instanceof ChainDataError) return { status: 422, body: { error: 'unexpected_object' } };
  return { status: 502, body: { error: 'upstream' } };
}

/**
 * Runs a chain read with CORS, the per-IP limit, error mapping and logging. `read` returns
 * `null` for "does not exist", which becomes a 404.
 */
export async function chainRoute(
  request: NextRequest,
  route: string,
  read: (chain: ChainService) => Promise<unknown>,
): Promise<NextResponse> {
  const startedAt = performance.now();
  const cors = corsOrigin(request);
  const origin = cors.allowed ? cors.origin : null;
  const respond = (body: unknown, status: number, extra?: Record<string, string>) => {
    logLine(route, status, startedAt);
    return json(body, status, origin, extra);
  };

  if (!cors.allowed) return respond({ error: 'forbidden_origin' }, 403);
  const limit = perIp.check(clientIp(request));
  if (!limit.ok) return respond({ error: 'rate_limited' }, 429, { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) });

  try {
    const result = await read(getChainService());
    if (result === null) return respond({ error: 'not_found' }, 404);
    return respond(result, 200);
  } catch (error) {
    const mapped = failure(error);
    return respond(mapped.body, mapped.status, mapped.headers);
  }
}

/** CORS preflight. The routes are simple GETs, but some clients preflight anyway. */
export function preflight(request: NextRequest): NextResponse {
  const cors = corsOrigin(request);
  const response = new NextResponse(null, { status: cors.allowed ? 204 : 403 });
  response.headers.set('Vary', 'Origin');
  if (cors.allowed && cors.origin) {
    response.headers.set('Access-Control-Allow-Origin', cors.origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Max-Age', '600');
  }
  return response;
}
