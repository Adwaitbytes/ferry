/* eslint-disable security/detect-non-literal-fs-filename -- paths are this package's fixed build output, never user input */
import { generateSeed, openSeed, sealSeed } from '@ferry/memwal';
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_HOSTS,
  EXTENSION_PAGES_CSP,
  FIXED_HOST_PERMISSIONS,
  PERMISSIONS,
  buildManifest,
  resolveOrigins,
} from '../../manifest.config';
import { SESSION_KEY, VAULT_KEY } from '../../src/worker/vault';
import { PASSPHRASE, contentSender, harness, openPaired } from '../helpers';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../../.output/chrome-mv3/manifest.json', import.meta.url));

describe('device and key hygiene', () => {
  it('RT-77 idle auto-lock drops key access', async () => {
    vi.useFakeTimers();
    try {
      const h = await openPaired();
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      h.clock.t += 30 * 60 * 1000 + 1;
      const res = await h.worker.route(
        { type: 'recall.suggest', site: 'claude', draft: 'dinner plans' },
        contentSender(),
        'internal',
      );
      expect(res).toMatchObject({ ok: false, code: 'locked' });
      expect(h.engine.recallForDraft).not.toHaveBeenCalled();
      expect(h.worker.vault.keyInMemory()).toBe(false);
      expect(h.session.data.has(SESSION_KEY)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // DECISIONS 2026-11-08 replaced the non-extractable CryptoKey with a passphrase-sealed raw seed,
  // because the MemWal SDK signs with raw bytes. The case now asserts the replacement control.
  it('RT-78 (adapted per DECISIONS) the stored key is sealed: no seed at rest, wrong passphrase fails, lock clears it', async () => {
    const seed = generateSeed();
    const seedHex = Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join('');
    const sealed = await sealSeed(seed, PASSPHRASE);
    expect(JSON.stringify(sealed)).not.toContain(seedHex);
    expect(sealed).toMatchObject({
      kdf: 'PBKDF2-SHA256',
      iterations: 600_000,
      cipher: 'AES-GCM-256',
    });
    await expect(openSeed(sealed, 'not the passphrase')).rejects.toThrow();
    expect(Array.from(await openSeed(sealed, PASSPHRASE))).toEqual(Array.from(seed));

    const h = harness();
    await h.worker.vault.open(PASSPHRASE);
    expect(JSON.stringify(h.local.data.get(VAULT_KEY))).not.toContain('07'.repeat(32));
    await h.worker.vault.lock();
    expect(h.session.data.has(SESSION_KEY)).toBe(false);
    expect(h.worker.vault.keyInMemory()).toBe(false);
  }, 30_000);

  it('RT-79 manifest and CSP policy (source of truth)', () => {
    const m = buildManifest(resolveOrigins({ FERRY_WEB_ORIGIN_PROD: 'https://ferry.example' }));
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'none'");
    expect(m.host_permissions).not.toContain('<all_urls>');
    expect(
      m.host_permissions.every(
        (p) =>
          !p.includes('*://') &&
          [
            ...FIXED_HOST_PERMISSIONS,
            'https://ferry.example/*',
            'http://localhost:3000/*',
          ].includes(p as never),
      ),
    ).toBe(true);
    expect(m.externally_connectable.matches).toEqual([
      'https://ferry.example/*',
      'http://localhost:3000/*',
    ]);
    expect(
      m.permissions.every((p) =>
        ['storage', 'sidePanel', 'alarms', 'idle', 'scripting'].includes(p),
      ),
    ).toBe(true);
    expect(m.web_accessible_resources).toEqual([
      {
        resources: ['fonts/geist-latin-wght-normal.woff2'],
        matches: CHAT_HOSTS.map((h) => `${h}/*`),
      },
    ]);
    expect(() => resolveOrigins({ FERRY_API_ORIGIN: 'http://ferry.example' })).toThrow();
    expect(() => resolveOrigins({ FERRY_WEB_ORIGIN_PROD: 'http://ferry.example' })).toThrow();
    expect(() => resolveOrigins({ FERRY_WEB_ORIGIN_PROD: 'http://localhost:4000' })).toThrow();
    expect(() => resolveOrigins({ FERRY_API_ORIGIN: 'https://ferry.example/path' })).toThrow();
  });

  it.runIf(existsSync(OUT))('RT-79 manifest and CSP policy (built output)', () => {
    const m = JSON.parse(readFileSync(OUT, 'utf8')) as {
      content_security_policy: { extension_pages: string };
      host_permissions: string[];
      permissions: string[];
      externally_connectable: { matches: string[] };
    };
    expect(m.content_security_policy.extension_pages).toBe(EXTENSION_PAGES_CSP);
    expect(m.host_permissions).not.toContain('<all_urls>');
    expect(m.host_permissions.some((p) => p.startsWith('*://'))).toBe(false);
    expect([...m.permissions].sort()).toEqual([...PERMISSIONS].sort());
    expect(m.externally_connectable.matches).toHaveLength(1);
  });
});
