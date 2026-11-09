import { describe, expect, it } from 'vitest';
import { vaultStartMessage } from '../src/worker/service';
import { STORAGE_MODE_KEY, embeddingDefaults } from '../src/worker/storage-mode';
import { contentSender, harness, openPaired, panelSender, PASSPHRASE, webSender } from './helpers';

const KEY = ['sk', 'test', '0123456789abcdef'].join('-');

describe('Vault mode toggle', () => {
  it('starts in Standard mode with Seal sessions signed by the delegate key', async () => {
    const h = await openPaired();
    expect(await h.worker.route({ type: 'vault.status' }, panelSender, 'internal')).toEqual({
      ok: true,
      data: { mode: 'standard', embedding: null, sealSigner: 'delegate' },
    });
    expect(h.engines.lastVault).toBeNull();
  });

  it('switches new writes to Vault, storing the key only sealed under the seed', async () => {
    const h = await openPaired();
    const res = await h.worker.route(
      { type: 'vault.enable', embedding: { apiKey: KEY } },
      panelSender,
      'internal',
    );
    expect(res).toEqual({
      ok: true,
      data: {
        mode: 'vault',
        embedding: { apiBase: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
        sealSigner: 'delegate',
      },
    });
    expect(h.engines.lastVault).toEqual({
      apiKey: KEY,
      apiBase: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
    });
    const stored = h.local.data.get(STORAGE_MODE_KEY) as { sealedKey: unknown; apiKey?: unknown };
    expect(stored.apiKey).toBeUndefined();
    expect(stored.sealedKey).toMatchObject({ purpose: 'vault.embedding' });
    expect(
      JSON.stringify(await h.worker.route({ type: 'vault.status' }, panelSender, 'internal')),
    ).not.toContain(KEY);

    // A fresh worker reopening the vault rebuilds the Vault engine from the sealed key.
    await h.worker.route({ type: 'lock' }, panelSender, 'internal');
    h.engines.lastVault = null;
    await h.worker.route({ type: 'unlock', passphrase: PASSPHRASE }, panelSender, 'internal');
    expect(h.engines.lastVault).toMatchObject({ apiKey: KEY });
  });

  it('stays in Standard and says why when the provider rejects the key', async () => {
    const h = await openPaired();
    h.engines.failVault = Object.assign(
      new Error(`Embedding endpoint answered 401 for ${KEY}`),
      {},
    );
    const res = await h.worker.route(
      { type: 'vault.enable', embedding: { apiKey: KEY } },
      panelSender,
      'internal',
    );
    expect(res).toEqual({
      ok: false,
      code: 'upstream',
      message: 'The embedding provider rejected that key. Check it and try again.',
    });
    expect(await h.worker.route({ type: 'vault.status' }, panelSender, 'internal')).toMatchObject({
      ok: true,
      data: { mode: 'standard' },
    });
    expect(h.engines.lastVault).toBeNull();
  });

  it('switches back to Standard and drops the sealed key', async () => {
    const h = await openPaired();
    await h.worker.route(
      { type: 'vault.enable', embedding: { apiKey: KEY } },
      panelSender,
      'internal',
    );
    expect(await h.worker.route({ type: 'vault.disable' }, panelSender, 'internal')).toMatchObject({
      ok: true,
      data: { mode: 'standard', embedding: null },
    });
    expect(h.local.data.get(STORAGE_MODE_KEY)).toEqual({ mode: 'standard' });
    expect(h.engines.lastVault).toBeNull();
  });

  it('is panel only, and needs Ferry open and paired', async () => {
    const h = await openPaired();
    const enable = { type: 'vault.enable', embedding: { apiKey: KEY } };
    expect(await h.worker.route(enable, contentSender(), 'internal')).toMatchObject({
      code: 'forbidden_sender',
    });
    expect(await h.worker.route(enable, webSender, 'external')).toMatchObject({
      code: 'forbidden_sender',
    });
    expect(await h.worker.route({ type: 'vault.status' }, webSender, 'external')).toMatchObject({
      code: 'forbidden_sender',
    });
    await h.worker.route({ type: 'lock' }, panelSender, 'internal');
    expect(await h.worker.route(enable, panelSender, 'internal')).toMatchObject({ code: 'locked' });

    const fresh = harness();
    await fresh.worker.route({ type: 'unlock', passphrase: PASSPHRASE }, panelSender, 'internal');
    expect(await fresh.worker.route(enable, panelSender, 'internal')).toMatchObject({
      code: 'not_paired',
    });
  });

  it('forgets the mode on wipe', async () => {
    const h = await openPaired();
    await h.worker.route(
      { type: 'vault.enable', embedding: { apiKey: KEY } },
      panelSender,
      'internal',
    );
    await h.worker.route(
      { type: 'data.wipe', confirm: 'DELETE MY FERRY DATA' },
      panelSender,
      'internal',
    );
    expect(h.local.data.has(STORAGE_MODE_KEY)).toBe(false);
  });
});

describe('Vault helpers', () => {
  it('defaults the model per provider', () => {
    expect(embeddingDefaults({ apiKey: KEY, apiBase: 'https://openrouter.ai/api/v1/' })).toEqual({
      apiBase: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-small',
    });
    expect(embeddingDefaults({ apiKey: KEY, model: 'custom-1536' }).model).toBe('custom-1536');
  });

  it('never echoes provider bodies in errors', () => {
    const dims = Object.assign(new Error('x'), { name: 'EmbeddingDimensionError' });
    expect(vaultStartMessage(dims)).toMatch(/1536/);
    expect(vaultStartMessage(new Error(`Embedding endpoint answered 503 ${KEY}`))).toBe(
      'The embedding provider answered 503. Vault mode stays off; try again later.',
    );
    expect(vaultStartMessage(new TypeError('fetch failed'))).toBe(
      'Could not reach the embedding provider. Vault mode stays off.',
    );
    expect(vaultStartMessage('nope')).not.toContain(KEY);
  });
});
