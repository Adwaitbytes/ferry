import { GateCardList, GateEarnings, GateNonce, GateOwnerCard, GateProfile, GateSession } from '@ferry/core';
import { siwsMessage } from '@ferry/pay/siws';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { publicEnv } from './env';

/*
 * Ferry Gate management client (apps/gate). Sign-in is SIWS: the Gate issues a nonce, the wallet
 * signs a plain-text message naming this site, and the Gate returns a bearer session. The session
 * lives in memory only, so closing the tab signs out. Every response is parsed with the frozen
 * core schema the Gate's own tests check against.
 */

/** Sessions are short on purpose: the Gate allows up to 24 h, the Share page needs minutes. */
const SESSION_MS = 4 * 60 * 60_000;

export class GateError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GateError';
    this.status = status;
    this.code = code;
  }
}

const ErrorBody = z.object({ error: z.string().max(80) });

const MESSAGES: Record<string, string> = {
  unauthorized: 'Your Ferry Gate session ended. Sign in again.',
  forbidden: 'Only the wallet that owns the Public profile account can do this.',
  rate_limited: 'Ferry Gate is rate limiting this browser. Wait a few seconds and try again.',
  invalid_request: 'Ferry Gate rejected the request. Check the fields and try again.',
  not_found: 'That card does not exist or was killed.',
  siws_bad_signature: 'The wallet signature did not verify. Try signing in again.',
  siws_nonce_used: 'That sign-in was already used. Sign in again.',
  siws_expired: 'The sign-in message expired. Sign in again.',
  siws_wrong_domain: 'Ferry Gate is configured for a different site, so it refused this sign-in.',
};

export function gateConfigured(): boolean {
  return publicEnv.gateUrl !== null;
}

async function gateFetch<T>(path: string, schema: z.ZodType<T>, init: RequestInit & { token?: string } = {}): Promise<T> {
  if (!publicEnv.gateUrl) throw new GateError(0, 'not_configured', 'Ferry Gate is not configured on this deployment.');
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${publicEnv.gateUrl}${path}`, {
      ...rest,
      // Bearer sessions only: no cookies cross to the Gate, so there is nothing to forge.
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(rest.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new GateError(0, 'unreachable', 'Could not reach Ferry Gate. Check your connection and try again.');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    const code = parsed.success ? parsed.data.error : `http_${response.status}`;
    throw new GateError(response.status, code, MESSAGES[code] ?? `Ferry Gate returned ${response.status}. Try again.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new GateError(502, 'invalid_response', 'Ferry Gate sent a response this page cannot read.');
  return parsed.data;
}

export function getGateProfile(): Promise<GateProfile> {
  return gateFetch('/v1/profile', GateProfile);
}

export type SignMessage = (message: Uint8Array) => Promise<{ signature: string }>;

/**
 * SIWS sign-in. The Gate names the domain it binds sessions to; if that is not this page's host
 * the wallet would be asked to sign for another site, so the flow stops before signing.
 */
export async function signInToGate(address: string, sign: SignMessage, host: string): Promise<GateSession> {
  const issued = await gateFetch('/v1/auth/nonce', GateNonce, { method: 'POST', body: '{}' });
  if (issued.domain !== host) {
    throw new GateError(0, 'siws_wrong_domain', `Ferry Gate signs in for ${issued.domain}, not ${host}. Nothing was signed.`);
  }
  const now = Date.now();
  const message = siwsMessage({
    domain: issued.domain,
    address: normalizeSuiAddress(address),
    nonce: issued.nonce,
    issuedAt: new Date(now).toISOString(),
    expiry: new Date(now + SESSION_MS).toISOString(),
  });
  const { signature } = await sign(new TextEncoder().encode(message));
  return gateFetch('/v1/auth/session', GateSession, { method: 'POST', body: JSON.stringify({ message, signature }) });
}

export interface CardInput {
  name: string;
  scopeLabel: string;
  priceMicros: string;
  dailyCap: number;
  allowedAgents: string[];
}

export function listCards(token: string): Promise<GateCardList> {
  return gateFetch('/v1/manage/cards', GateCardList, { token });
}

export function createCard(token: string, input: CardInput): Promise<GateOwnerCard> {
  return gateFetch('/v1/manage/cards', GateOwnerCard, { method: 'POST', token, body: JSON.stringify(input) });
}

export function setCardEnabled(token: string, id: string, enabled: boolean): Promise<GateOwnerCard> {
  return gateFetch(`/v1/manage/cards/${encodeURIComponent(id)}`, GateOwnerCard, { method: 'PATCH', token, body: JSON.stringify({ enabled }) });
}

export function killCard(token: string, id: string): Promise<{ id: string; killed: true }> {
  return gateFetch(`/v1/manage/cards/${encodeURIComponent(id)}/kill`, z.object({ id: z.string(), killed: z.literal(true) }), {
    method: 'POST',
    token,
    body: '{}',
  });
}

export function getEarnings(owner: string, token: string): Promise<GateEarnings> {
  return gateFetch(`/v1/earnings?owner=${encodeURIComponent(normalizeSuiAddress(owner))}`, GateEarnings, { token });
}
