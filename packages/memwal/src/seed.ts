import { delegateKeyToPublicKey, delegateKeyToSuiAddress } from '@mysten-incubation/memwal';

/** OWASP 2023 floor for PBKDF2-HMAC-SHA256 (DECISIONS, THREAT_MODEL X-KEY-2). */
export const PBKDF2_ITERATIONS = 600_000;
export const SEED_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_PASSPHRASE = 8;

/** Versioned so the KDF can be raised later without guessing what an old blob used. */
export interface SealedSeed {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-GCM-256';
  salt: string;
  iv: string;
  ciphertext: string;
}

export class SeedError extends Error {
  override readonly name = 'SeedError';
  constructor(
    readonly code: 'wrong_passphrase' | 'invalid_envelope' | 'invalid_seed' | 'weak_passphrase',
    message: string,
  ) {
    super(message);
  }
}

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Best effort: JS strings and engine copies cannot be wiped, but buffers we own can. */
export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0);
}

function assertSeed(seed: Uint8Array): void {
  if (!(seed instanceof Uint8Array) || seed.length !== SEED_BYTES) throw new SeedError('invalid_seed', 'seed must be 32 bytes');
}

export function generateSeed(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

/** Binds version and KDF cost into the GCM tag, so editing the envelope fails decryption. */
function aad(iterations: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`ferry-seed:v1:PBKDF2-SHA256:${iterations}:AES-GCM-256`);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const pass = new TextEncoder().encode(passphrase.normalize('NFKC'));
  try {
    const base = await subtle().importKey('raw', pass, 'PBKDF2', false, ['deriveKey']);
    return await subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
  } finally {
    zeroize(pass);
  }
}

export async function sealSeed(seed: Uint8Array, passphrase: string): Promise<SealedSeed> {
  assertSeed(seed);
  if (passphrase.length < MIN_PASSPHRASE) throw new SeedError('weak_passphrase', `passphrase must be at least ${MIN_PASSPHRASE} characters`);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plain = new Uint8Array(seed);
  try {
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(PBKDF2_ITERATIONS) }, key, plain));
    return { v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, cipher: 'AES-GCM-256', salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ct) };
  } finally {
    zeroize(plain);
  }
}

function parseEnvelope(blob: unknown): SealedSeed {
  const e = blob as Partial<SealedSeed> | null;
  if (
    e === null ||
    typeof e !== 'object' ||
    e.v !== 1 ||
    e.kdf !== 'PBKDF2-SHA256' ||
    e.cipher !== 'AES-GCM-256' ||
    e.iterations !== PBKDF2_ITERATIONS ||
    typeof e.salt !== 'string' ||
    typeof e.iv !== 'string' ||
    typeof e.ciphertext !== 'string'
  ) {
    throw new SeedError('invalid_envelope', 'not a Ferry sealed seed');
  }
  return e as SealedSeed;
}

/** Returns the seed. The caller owns the buffer and should `zeroize` it when done. */
export async function openSeed(blob: unknown, passphrase: string): Promise<Uint8Array> {
  const env = parseEnvelope(blob);
  let salt: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>;
  try {
    salt = fromB64(env.salt);
    iv = fromB64(env.iv);
    ct = fromB64(env.ciphertext);
  } catch {
    throw new SeedError('invalid_envelope', 'sealed seed is not valid base64');
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new SeedError('invalid_envelope', 'sealed seed has a bad salt or iv');
  const key = await deriveKey(passphrase, salt, env.iterations);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad(env.iterations) }, key, ct));
  } catch {
    // GCM cannot tell a wrong passphrase from a tampered blob; both mean "do not trust this".
    throw new SeedError('wrong_passphrase', 'wrong passphrase or damaged sealed seed');
  }
  if (plain.length !== SEED_BYTES) {
    zeroize(plain);
    throw new SeedError('invalid_seed', 'sealed seed has the wrong length');
  }
  return plain;
}

function seedHex(seed: Uint8Array): string {
  assertSeed(seed);
  let hex = '';
  for (const b of seed) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** The delegate public key, 64 hex chars without 0x. This is MEMWAL_AGENT_ID (RESEARCH 1.1). */
export async function publicKeyHex(seed: Uint8Array): Promise<string> {
  const pk = await delegateKeyToPublicKey(seedHex(seed));
  let hex = '';
  for (const b of pk) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** blake2b256(0x00 || pk), 0x prefixed, as registered in `DelegateKey.sui_address`. */
export function suiAddress(seed: Uint8Array): Promise<string> {
  return delegateKeyToSuiAddress(seedHex(seed));
}

/**
 * A small secret (the Vault mode embedding key) sealed under a key derived from the delegate seed.
 * It is readable only while Ferry is open, exactly like the seed, without asking for the
 * passphrase a second time. `purpose` is bound into both the HKDF info and the GCM tag, so a blob
 * sealed for one use cannot be replayed as another.
 */
export interface SealedSecret {
  v: 1;
  kdf: 'HKDF-SHA256';
  cipher: 'AES-GCM-256';
  purpose: string;
  iv: string;
  ciphertext: string;
}

const PURPOSE = /^[a-z][a-z0-9.-]{0,63}$/;
const MAX_SECRET_CHARS = 4096;

async function secretKey(seed: Uint8Array, purpose: string): Promise<CryptoKey> {
  assertSeed(seed);
  const raw = new Uint8Array(seed);
  try {
    const base = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    return await subtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(`ferry-secret:v1:${purpose}`) },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    zeroize(raw);
  }
}

export async function sealSecret(seed: Uint8Array, purpose: string, secret: string): Promise<SealedSecret> {
  if (!PURPOSE.test(purpose)) throw new TypeError('purpose must be a short lowercase label');
  if (secret.length === 0 || secret.length > MAX_SECRET_CHARS) throw new TypeError('secret must be 1 to 4096 characters');
  const key = await secretKey(seed, purpose);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(secret);
  try {
    const ct = new Uint8Array(
      await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`ferry-secret:v1:${purpose}`) }, key, plain),
    );
    return { v: 1, kdf: 'HKDF-SHA256', cipher: 'AES-GCM-256', purpose, iv: toB64(iv), ciphertext: toB64(ct) };
  } finally {
    zeroize(plain);
  }
}

export async function openSecret(seed: Uint8Array, purpose: string, blob: unknown): Promise<string> {
  const e = blob as Partial<SealedSecret> | null;
  if (
    e === null ||
    typeof e !== 'object' ||
    e.v !== 1 ||
    e.kdf !== 'HKDF-SHA256' ||
    e.cipher !== 'AES-GCM-256' ||
    e.purpose !== purpose ||
    typeof e.iv !== 'string' ||
    typeof e.ciphertext !== 'string'
  ) {
    throw new SeedError('invalid_envelope', 'not a Ferry sealed secret for this purpose');
  }
  let iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>;
  try {
    iv = fromB64(e.iv);
    ct = fromB64(e.ciphertext);
  } catch {
    throw new SeedError('invalid_envelope', 'sealed secret is not valid base64');
  }
  if (iv.length !== IV_BYTES) throw new SeedError('invalid_envelope', 'sealed secret has a bad iv');
  const key = await secretKey(seed, purpose);
  try {
    const plain = new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`ferry-secret:v1:${purpose}`) }, key, ct),
    );
    const text = new TextDecoder().decode(plain);
    zeroize(plain);
    return text;
  } catch {
    throw new SeedError('wrong_passphrase', 'sealed secret does not open with this key');
  }
}
