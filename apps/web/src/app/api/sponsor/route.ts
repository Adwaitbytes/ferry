import { z } from 'zod';
import { clientIp, json, log, readCapped, takeToken } from '@/server/guard';

const RELAYER = process.env.MEMWAL_RELAYER_URL ?? 'https://relayer.memory.walrus.xyz';
const Address = z.string().regex(/^0x[0-9a-f]{64}$/);
const B64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(16_000);

const SponsorBody = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('sponsor'),
    sender: Address,
    transactionBlockKindBytes: B64,
    authSignature: B64,
    authTimestamp: z.number().int().positive(),
    authNonce: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('execute'),
    sender: Address,
    digest: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{42,44}$/),
    signature: B64,
  }),
]);

/**
 * Same-origin proxy to the Walrus Memory relayer's sponsored gas endpoints, which send no CORS
 * header (RESEARCH 1.7). The relayer itself enforces the MemWal call allowlist, the sender's
 * signature and per-sender limits; this route only validates shape and forwards known fields.
 */
export async function POST(req: Request): Promise<Response> {
  const started = Date.now();
  const done = (status: number, body: unknown, code?: string) => {
    log({ route: 'sponsor', status, durationMs: Date.now() - started, ...(code ? { code } : {}) });
    return json(status, body);
  };
  if (!takeToken(`sponsor:${clientIp(req)}`, 10)) return done(429, { error: 'RATE_LIMITED' }, 'RATE_LIMITED');
  const raw = await readCapped(req, 32 * 1024);
  if (raw === null) return done(413, { error: 'BODY_TOO_LARGE' }, 'BODY_TOO_LARGE');
  let parsed;
  try {
    parsed = SponsorBody.safeParse(JSON.parse(raw));
  } catch {
    return done(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST');
  }
  if (!parsed.success) return done(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST');
  const { action, ...body } = parsed.data;
  const path = action === 'sponsor' ? '/sponsor' : '/sponsor/execute';
  try {
    const upstream = await fetch(`${RELAYER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upstream.ok) return done(upstream.status, { error: String(payload.code ?? 'SPONSOR_FAILED') }, 'UPSTREAM');
    if (action === 'sponsor') return done(200, { bytes: payload.bytes, digest: payload.digest });
    return done(200, { digest: payload.digest ?? ('digest' in body ? body.digest : null) });
  } catch {
    return done(502, { error: 'RELAYER_UNREACHABLE' }, 'UPSTREAM');
  }
}
