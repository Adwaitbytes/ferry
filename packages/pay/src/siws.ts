import type { ClientWithCoreApi } from '@mysten/sui/client';
import { isValidPersonalMessageSignature } from '@mysten/sui/verify';
import { z } from 'zod';
import { randomToken } from './hash.js';
import { tryNormalizeAddress } from './normalize.js';
import type { PayStore } from './store.js';

export const NONCE_TTL_MS = 10 * 60_000;
export const MAX_SESSION_MS = 24 * 60 * 60_000;
const SKEW_MS = 60_000;

export interface SiwsFields {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expiry: string;
}

/**
 * The exact text the wallet signs. Plain lines, so the user sees what they authorize; every
 * field is parsed back strictly and the whole string must match the rebuilt one.
 */
export function siwsMessage(fields: SiwsFields): string {
  return [
    `${fields.domain} wants you to sign in to Ferry with your Sui account:`,
    fields.address,
    '',
    'Sign in to manage your Ferry Share Cards.',
    '',
    `Domain: ${fields.domain}`,
    `Address: ${fields.address}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expiry}`,
  ].join('\n');
}

const FIELD_RE = /^Domain: (?<domain>[a-z0-9.:-]{1,253})\nAddress: (?<address>0x[0-9a-f]{64})\nNonce: (?<nonce>[A-Za-z0-9_-]{22})\nIssued At: (?<issuedAt>[0-9TZ:.-]{20,30})\nExpiration Time: (?<expiry>[0-9TZ:.-]{20,30})$/;

export function parseSiwsMessage(message: string): SiwsFields | null {
  const tail = message.split('\n').slice(-5).join('\n');
  const groups = FIELD_RE.exec(tail)?.groups;
  if (!groups) return null;
  const fields: SiwsFields = {
    domain: groups['domain'] ?? '',
    address: groups['address'] ?? '',
    nonce: groups['nonce'] ?? '',
    issuedAt: groups['issuedAt'] ?? '',
    expiry: groups['expiry'] ?? '',
  };
  return siwsMessage(fields) === message ? fields : null;
}

export const SessionRequest = z.object({ message: z.string().min(1).max(2000), signature: z.string().min(1).max(4096) });
export type SessionRequest = z.infer<typeof SessionRequest>;

export type SiwsFailure = 'MALFORMED' | 'WRONG_DOMAIN' | 'EXPIRED' | 'BAD_SIGNATURE' | 'NONCE_USED';

export async function issueNonce(store: PayStore, nowMs: number): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = randomToken();
  const expiresAtMs = nowMs + NONCE_TTL_MS;
  await store.createNonce(nonce, expiresAtMs);
  return { nonce, expiresAt: new Date(expiresAtMs).toISOString() };
}

/**
 * SIWS verification: domain binding, time window, signature by the claimed address, then the
 * nonce is consumed last so a bad signature cannot burn someone else's nonce.
 */
export async function verifySiws(
  request: SessionRequest,
  options: { store: PayStore; domain: string; nowMs: number; client?: ClientWithCoreApi },
): Promise<{ ok: true; address: string; expiresAtMs: number } | { ok: false; reason: SiwsFailure }> {
  const fields = parseSiwsMessage(request.message);
  if (!fields || tryNormalizeAddress(fields.address) !== fields.address) return { ok: false, reason: 'MALFORMED' };
  if (fields.domain !== options.domain) return { ok: false, reason: 'WRONG_DOMAIN' };
  const issuedAtMs = Date.parse(fields.issuedAt);
  const expiresAtMs = Date.parse(fields.expiry);
  if (Number.isNaN(issuedAtMs) || Number.isNaN(expiresAtMs)) return { ok: false, reason: 'MALFORMED' };
  if (issuedAtMs > options.nowMs + SKEW_MS || expiresAtMs <= options.nowMs || expiresAtMs - issuedAtMs > MAX_SESSION_MS) {
    return { ok: false, reason: 'EXPIRED' };
  }
  let valid: boolean;
  try {
    valid = await isValidPersonalMessageSignature(new TextEncoder().encode(request.message), request.signature, {
      address: fields.address,
      ...(options.client ? { client: options.client } : {}),
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (!(await options.store.consumeNonce(fields.nonce, options.nowMs))) return { ok: false, reason: 'NONCE_USED' };
  return { ok: true, address: fields.address, expiresAtMs };
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('session secret must be at least 32 characters');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const SessionClaims = z.object({ a: z.string().regex(/^0x[0-9a-f]{64}$/), d: z.string().min(1).max(253), e: z.number().int().positive() });

/** `v1.<claims>.<hmac>`: stateless, so a session survives across serverless instances. */
export async function signSession(claims: { address: string; domain: string; expiresAtMs: number }, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify({ a: claims.address, d: claims.domain, e: claims.expiresAtMs })));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`v1.${body}`)));
  return `v1.${body}.${b64url(mac)}`;
}

/** Returns the session address, or null for anything forged, expired or for another domain. */
export async function verifySession(token: string, options: { secret: string; domain: string; nowMs: number }): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] === undefined || parts[2] === undefined) return null;
  const mac = fromB64url(parts[2]);
  const body = fromB64url(parts[1]);
  if (!mac || !body) return null;
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(options.secret), mac, encoder.encode(`v1.${parts[1]}`));
  if (!valid) return null;
  let claims: z.infer<typeof SessionClaims>;
  try {
    claims = SessionClaims.parse(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    return null;
  }
  if (claims.d !== options.domain || claims.e <= options.nowMs) return null;
  return claims.a;
}
