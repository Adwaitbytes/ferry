import { delegateKeyToPublicKey } from '@mysten-incubation/memwal';
import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, SeedError, generateSeed, openSeed, publicKeyHex, sealSeed, suiAddress, zeroize } from './seed.js';

// Built at runtime from fragments so no secret-shaped literal sits in the repo (THREAT_MODEL X-CI-2).
const PASS = ['correct', 'horse', 'battery'].join('-');

describe('seed sealing', () => {
  it('round trips with the right passphrase and a versioned envelope', async () => {
    const seed = generateSeed();
    expect(seed).toHaveLength(32);
    const sealed = await sealSeed(seed, PASS);
    expect(sealed).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, cipher: 'AES-GCM-256' });
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const opened = await openSeed(JSON.parse(JSON.stringify(sealed)), PASS);
    expect(opened).toEqual(seed);
    const again = await sealSeed(seed, PASS);
    expect(again.salt).not.toBe(sealed.salt);
    expect(again.iv).not.toBe(sealed.iv);
  });

  it('fails with wrong_passphrase on a wrong passphrase or a tampered ciphertext', async () => {
    const sealed = await sealSeed(generateSeed(), PASS);
    await expect(openSeed(sealed, `${PASS}x`)).rejects.toMatchObject({ code: 'wrong_passphrase' });
    const bytes = atob(sealed.ciphertext);
    const flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1);
    await expect(openSeed({ ...sealed, ciphertext: btoa(flipped) }, PASS)).rejects.toMatchObject({ code: 'wrong_passphrase' });
  });

  it('rejects malformed envelopes, weak passphrases and bad seeds', async () => {
    const sealed = await sealSeed(generateSeed(), PASS);
    await expect(openSeed(null, PASS)).rejects.toMatchObject({ code: 'invalid_envelope' });
    await expect(openSeed({ ...sealed, iterations: 1000 }, PASS)).rejects.toMatchObject({ code: 'invalid_envelope' });
    await expect(openSeed({ ...sealed, salt: '!!!' }, PASS)).rejects.toMatchObject({ code: 'invalid_envelope' });
    await expect(openSeed({ ...sealed, iv: btoa('short') }, PASS)).rejects.toMatchObject({ code: 'invalid_envelope' });
    await expect(sealSeed(generateSeed(), 'short')).rejects.toMatchObject({ code: 'weak_passphrase' });
    await expect(sealSeed(new Uint8Array(16), PASS)).rejects.toBeInstanceOf(SeedError);
  });

  it('rejects a sealed payload of the wrong length', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ]);
    const ad = new TextEncoder().encode(`ferry-seed:v1:PBKDF2-SHA256:${PBKDF2_ITERATIONS}:AES-GCM-256`);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, new Uint8Array(8)));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const env = { v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, cipher: 'AES-GCM-256', salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) };
    await expect(openSeed(env, PASS)).rejects.toMatchObject({ code: 'invalid_seed' });
  });

  it('zeroizes buffers', () => {
    const b = new Uint8Array([1, 2, 3]);
    zeroize(b);
    expect([...b]).toEqual([0, 0, 0]);
  });
});

describe('delegate identity helpers', () => {
  it('derives the agent id and Sui address through the SDK helpers', async () => {
    const seed = new Uint8Array(32).fill(1);
    const hex = await publicKeyHex(seed);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const sdk = await delegateKeyToPublicKey('01'.repeat(32));
    expect(hex).toBe([...sdk].map((b) => b.toString(16).padStart(2, '0')).join(''));
    const addr = await suiAddress(seed);
    expect(addr).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await suiAddress(seed)).toBe(addr);
    await expect(publicKeyHex(new Uint8Array(3))).rejects.toThrow(/32 bytes/);
  });
});
