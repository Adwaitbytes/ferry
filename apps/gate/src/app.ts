import { CardId, GateRecallQuery, GateRecallResult, randomId128 } from '@ferry/core';
import {
  DEFAULT_PRICE_MICROS,
  GatePayments,
  GateGuard,
  MAINNET_USDC_TYPE,
  MAX_PRICE_MICROS,
  PAY_ERRORS,
  PUBLIC_NAMESPACE,
  SessionRequest,
  issueNonce,
  microsToDecimal,
  normalizeAddress,
  sha256Hex,
  signSession,
  tryNormalizeAddress,
  verifySession,
  verifySiws,
  type Card,
  type PayErrorCode,
  type PayStore,
  type SettleResult,
} from '@ferry/pay';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import type { GateLog } from './log.js';
import type { PublicRecall } from './recall.js';

export interface GatePaymentsLike {
  paymentRequired: GatePayments['paymentRequired'];
  settle: GatePayments['settle'];
}

export interface GateDeps {
  store: PayStore;
  payments: GatePaymentsLike;
  guard: GateGuard;
  recall: PublicRecall;
  log: GateLog;
  /** The only account the Gate can read, and the address allowed to publish cards over it. */
  publicAccountId: string;
  publicAccountOwner: string;
  /** Exact web app origin: CORS for auth, management and earnings, and the SIWS domain. */
  webOrigin: string;
  sessionSecret: string;
  /** Tatum USDC/USD rate for the Earnings fiat total. Optional: earnings still render without it. */
  usdcUsdPrice?: () => Promise<{ usd: string }>;
  now?: () => number;
}

const WHOLE_RE = /^\d{1,9}$/;
const FRACTION_RE = /^\d{1,18}$/;

/** USDC micros times a decimal USD rate, in cents, using bigint only (no float on money). */
export function microsToUsd(micros: bigint, usd: string): string | null {
  const parts = usd.split('.');
  const [whole = '', fraction = ''] = parts;
  if (parts.length > 2 || !WHOLE_RE.test(whole) || (parts.length === 2 && !FRACTION_RE.test(fraction))) return null;
  const scale = 10n ** BigInt(fraction.length);
  const rate = BigInt(`${whole}${fraction}`);
  const cents = (micros * rate * 100n) / (1_000_000n * scale);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

type Env = { Variables: { started: number; cardId?: string; receiptId?: string; code?: string } };

const RECALL_LIMIT = 5;
const MAX_BODY_BYTES = 8 * 1024;
const SUISCAN_TX = 'https://suiscan.xyz/mainnet/tx/';

const Address = z.string().refine((value) => tryNormalizeAddress(value) !== null, 'not a Sui address');
const isPlainLabel = (value: string) => [...value].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f && ch !== '<' && ch !== '>');
const Label = (max: number) => z.string().trim().min(1).max(max).refine(isPlainLabel, 'no control characters or angle brackets');
const MicrosString = z.string().regex(/^[1-9][0-9]{0,8}$/).transform((value) => BigInt(value)).refine((value) => value <= MAX_PRICE_MICROS);
const CreateCard = z.strictObject({
  name: Label(60),
  scopeLabel: Label(40),
  priceMicros: MicrosString.optional(),
  dailyCap: z.number().int().min(1).max(100_000).optional(),
  allowedAgents: z.array(Address).max(20).optional(),
});
const UpdateCard = z.strictObject({
  name: Label(60).optional(),
  scopeLabel: Label(40).optional(),
  priceMicros: MicrosString.optional(),
  dailyCap: z.number().int().min(1).max(100_000).optional(),
  allowedAgents: z.array(Address).max(20).optional(),
  enabled: z.boolean().optional(),
});

function clientIp(c: Context): string {
  // Vercel sets x-real-ip to the connecting client; x-forwarded-for is the fallback for local runs.
  const real = c.req.header('x-real-ip');
  if (real) return real.trim();
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** RT-54: one body for every "no such card" so unknown, killed and disabled are identical. */
const NOT_FOUND_BODY = '{"error":"not_found"}';

function jsonError(c: Context<Env>, status: number, code: string, headers: Record<string, string> = {}): Response {
  c.set('code', code);
  const body = code === 'not_found' ? NOT_FOUND_BODY : JSON.stringify({ error: code });
  return new Response(body, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function payError(c: Context<Env>, code: PayErrorCode): Response {
  return jsonError(c, PAY_ERRORS[code], code.toLowerCase());
}

function publicCard(card: Card) {
  return {
    id: card.id,
    name: card.name,
    scopeLabel: card.scopeLabel,
    priceMicros: card.priceMicros.toString(),
    price: microsToDecimal(card.priceMicros),
    currency: MAINNET_USDC_TYPE,
    recipient: normalizeAddress(card.ownerAddress),
  };
}

function ownerCard(card: Card) {
  return { ...publicCard(card), dailyCap: card.dailyCap, allowedAgents: card.allowedAgents, enabled: card.enabled, killed: card.killed, createdAt: new Date(card.createdAtMs).toISOString() };
}

async function readJson(c: Context<Env>): Promise<unknown> {
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) return undefined;
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function createApp(deps: GateDeps): Hono<Env> {
  const now = deps.now ?? Date.now;
  const domain = new URL(deps.webOrigin).host;
  const ownerAddress = normalizeAddress(deps.publicAccountOwner);
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    c.set('started', performance.now());
    await next();
    deps.log({
      route: c.req.routePath,
      method: c.req.method,
      status: c.res.status,
      durationMs: performance.now() - c.get('started'),
      ...(c.get('cardId') ? { cardId: c.get('cardId') } : {}),
      ...(c.get('receiptId') ? { receiptId: c.get('receiptId') } : {}),
      ...(c.get('code') ? { code: c.get('code') } : {}),
    });
  });
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      crossOriginResourcePolicy: 'same-site',
    }),
  );
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => jsonError(c, 413, 'body_too_large') }));
  for (const path of ['/v1/auth/*', '/v1/manage/*', '/v1/earnings', '/v1/profile']) {
    app.use(path, cors({ origin: deps.webOrigin, allowMethods: ['GET', 'POST', 'PATCH'], allowHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  }
  // Agents call the card routes from anywhere, so they need no credentials and expose the
  // payment headers. Card management stays on the strict CORS above.
  app.use(
    '/v1/cards/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-PAYMENT'],
      exposeHeaders: ['WWW-Authenticate', 'Payment-Receipt', 'X-PAYMENT-RESPONSE', 'Retry-After'],
    }),
  );

  /** Rate limit then card lookup, shared by both public card routes. */
  async function cardOr(c: Context<Env>): Promise<Card | Response> {
    // Format first: a malformed id costs no database access at all (RT-53).
    if (!GateGuard.isCardId(c.req.param('cardId') ?? '')) return jsonError(c, 400, 'invalid_card_id');
    const ip = clientIp(c);
    const nowMs = now();
    const wait = await deps.guard.limitRequest(ip, nowMs);
    if (wait !== null) return jsonError(c, 429, 'rate_limited', { 'Retry-After': String(wait) });
    const resolved = await deps.guard.resolveCard(c.req.param('cardId') ?? '', ip, nowMs);
    if (resolved.kind === 'invalid') return jsonError(c, 400, 'invalid_card_id');
    if (resolved.kind === 'limited') return jsonError(c, 429, 'rate_limited', { 'Retry-After': String(resolved.retryAfterS) });
    if (resolved.kind === 'not_found') return jsonError(c, 404, 'not_found');
    c.set('cardId', resolved.card.id);
    return resolved.card;
  }

  async function session(c: Context<Env>): Promise<string | null> {
    const header = c.req.header('authorization');
    if (!header?.startsWith('Bearer ')) return null;
    return verifySession(header.slice(7), { secret: deps.sessionSecret, domain, nowMs: now() });
  }

  app.get('/health', (c) => c.json({ ok: true, service: 'ferry-gate' }));

  // Lets the web app say honestly who may create cards before anyone signs a message. The owner is
  // already public as every card's payment recipient.
  app.get('/v1/profile', (c) => c.json({ publicAccountId: deps.publicAccountId, owner: ownerAddress, namespace: PUBLIC_NAMESPACE }));

  app.get('/v1/cards/:cardId', async (c) => {
    const card = await cardOr(c);
    return card instanceof Response ? card : c.json(publicCard(card));
  });

  const recallRoute = async (c: Context<Env>, rawQuery: unknown): Promise<Response> => {
    const card = await cardOr(c);
    if (card instanceof Response) return card;
    const query = GateRecallQuery.safeParse({ q: rawQuery });
    if (!query.success) return jsonError(c, 400, 'invalid_request');
    const resource = new URL(c.req.url);
    // Vercel terminates TLS before the function, so the request URL says http; paying clients
    // compare the challenge resource with the URL they called, which is https.
    if (c.req.header('x-forwarded-proto') === 'https') resource.protocol = 'https:';
    resource.search = '';

    if (GatePayments.dialectOf(c.req.raw) === null) {
      if (!(await deps.guard.underDailyCap(card, now()))) return jsonError(c, 429, 'daily_cap');
      const required = await deps.payments.paymentRequired(card, resource.toString());
      c.set('code', 'payment_required');
      return required.response;
    }

    // Only a hash of the query is ever stored or logged (X-GATE-2).
    const querySha256 = await sha256Hex(query.data.q);
    const settled: SettleResult = await deps.payments.settle(c.req.raw, card, querySha256);
    if ('code' in settled) return payError(c, settled.code);
    c.set('receiptId', settled.receiptId);

    let results: GateRecallResult['results'];
    try {
      results = await deps.recall.recall(query.data.q, RECALL_LIMIT);
    } catch {
      // Paid but the relayer failed: return the receipt so the payment is never invisible.
      return c.json({ error: 'recall_unavailable', receiptId: settled.receiptId, digest: settled.digest }, 502);
    }
    const body = GateRecallResult.parse({
      cardId: card.id,
      results,
      payment: { digest: settled.digest, amountMicros: settled.amountMicros.toString(), receiptId: settled.receiptId, payer: settled.payer },
    });
    return settled.attach(c.json(body));
  };

  app.get('/v1/cards/:cardId/recall', (c) => recallRoute(c, c.req.query('q')));
  app.post('/v1/cards/:cardId/recall', async (c) => {
    const body = await readJson(c);
    const q = typeof body === 'object' && body !== null && 'q' in body ? body.q : undefined;
    return recallRoute(c, q);
  });

  app.post('/v1/auth/nonce', async (c) => {
    const wait = await deps.guard.limitRequest(clientIp(c), now());
    if (wait !== null) return jsonError(c, 429, 'rate_limited', { 'Retry-After': String(wait) });
    return c.json({ ...(await issueNonce(deps.store, now())), domain });
  });

  app.post('/v1/auth/session', async (c) => {
    const parsed = SessionRequest.safeParse(await readJson(c));
    if (!parsed.success) return jsonError(c, 400, 'invalid_request');
    const verified = await verifySiws(parsed.data, { store: deps.store, domain, nowMs: now() });
    if (!verified.ok) return jsonError(c, 401, `siws_${verified.reason.toLowerCase()}`);
    const token = await signSession({ address: verified.address, domain, expiresAtMs: verified.expiresAtMs }, deps.sessionSecret);
    return c.json({ token, address: verified.address, expiresAt: new Date(verified.expiresAtMs).toISOString() });
  });

  app.get('/v1/earnings', async (c) => {
    const owner = tryNormalizeAddress(c.req.query('owner') ?? '');
    if (!owner) return jsonError(c, 400, 'invalid_request');
    const address = await session(c);
    if (!address) return jsonError(c, 401, 'unauthorized');
    // Query hashes are not on chain, so earnings are private to the owner.
    if (address !== owner) return jsonError(c, 403, 'forbidden');
    const earnings = await deps.store.earnings(owner, now(), 100);
    let usd: string | null;
    try {
      usd = deps.usdcUsdPrice ? (await deps.usdcUsdPrice()).usd : null;
    } catch {
      usd = null;
    }
    return c.json({
      owner,
      currency: MAINNET_USDC_TYPE,
      totals: {
        count: earnings.count,
        totalMicros: earnings.totalMicros.toString(),
        total: microsToDecimal(earnings.totalMicros),
        todayMicros: earnings.todayMicros.toString(),
        today: microsToDecimal(earnings.todayMicros),
        usdcUsd: usd,
        totalUsd: usd === null ? null : microsToUsd(earnings.totalMicros, usd),
        priceSource: usd === null ? null : 'tatum',
      },
      payments: earnings.payments.map((p) => ({
        receiptId: p.receiptId,
        cardId: p.cardId,
        cardName: p.cardName,
        agent: p.payer,
        querySha256: p.querySha256,
        amountMicros: p.amountMicros.toString(),
        amount: microsToDecimal(p.amountMicros),
        digest: p.digest,
        explorerUrl: `${SUISCAN_TX}${p.digest}`,
        createdAt: new Date(p.createdAtMs).toISOString(),
      })),
    });
  });

  app.get('/v1/manage/cards', async (c) => {
    const address = await session(c);
    if (!address) return jsonError(c, 401, 'unauthorized');
    return c.json({ cards: (await deps.store.listCardsByOwner(address)).map(ownerCard) });
  });

  app.post('/v1/manage/cards', async (c) => {
    const address = await session(c);
    if (!address) return jsonError(c, 401, 'unauthorized');
    // Only the owner of the Public profile account may sell what is in it.
    if (address !== ownerAddress) return jsonError(c, 403, 'forbidden');
    const parsed = CreateCard.safeParse(await readJson(c));
    if (!parsed.success) return jsonError(c, 400, 'invalid_request');
    const card = await deps.store.createCard({
      id: randomId128(),
      ownerAddress: address,
      publicAccountId: deps.publicAccountId,
      name: parsed.data.name,
      scopeLabel: parsed.data.scopeLabel,
      priceMicros: parsed.data.priceMicros ?? DEFAULT_PRICE_MICROS,
      dailyCap: parsed.data.dailyCap ?? 100,
      allowedAgents: (parsed.data.allowedAgents ?? []).map(normalizeAddress),
    });
    c.set('cardId', card.id);
    return c.json(ownerCard(card), 201);
  });

  app.patch('/v1/manage/cards/:cardId', async (c) => {
    const address = await session(c);
    if (!address) return jsonError(c, 401, 'unauthorized');
    const id = c.req.param('cardId');
    if (!CardId.safeParse(id).success) return jsonError(c, 400, 'invalid_card_id');
    const parsed = UpdateCard.safeParse(await readJson(c));
    if (!parsed.success) return jsonError(c, 400, 'invalid_request');
    const { allowedAgents, ...rest } = parsed.data;
    const patch = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    const card = await deps.store.updateCard(id, address, { ...patch, ...(allowedAgents ? { allowedAgents: allowedAgents.map(normalizeAddress) } : {}) });
    return card ? c.json(ownerCard(card)) : jsonError(c, 404, 'not_found');
  });

  app.post('/v1/manage/cards/:cardId/kill', async (c) => {
    const address = await session(c);
    if (!address) return jsonError(c, 401, 'unauthorized');
    const id = c.req.param('cardId');
    if (!CardId.safeParse(id).success) return jsonError(c, 400, 'invalid_card_id');
    return (await deps.store.killCard(id, address)) ? c.json({ id, killed: true }) : jsonError(c, 404, 'not_found');
  });

  app.notFound((c) => jsonError(c, 404, 'not_found'));
  // The error name is logged, never its message: messages can carry upstream text.
  app.onError((error, c) => {
    const response = jsonError(c, 500, 'internal');
    c.set('code', `internal:${error.name}`.slice(0, 60));
    return response;
  });
  return app;
}
