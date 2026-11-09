import { MemWalMock } from '@mysten-incubation/memwal';
import type { WalletSigner } from '@mysten-incubation/memwal/manual';
import { describe, expect, it, vi } from 'vitest';
import { UnsupportedInModeError } from './engine.js';
import { ACCOUNT, SEED, TestClock, fact, freshDb } from './test/fakes.js';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { EMBEDDING_DIMS, EmbeddingDimensionError, FerryVaultMemory, manualSignerConfig, verifyEmbeddingDimensions, type ManualClient } from './vault.js';

const KEY = ['sk', 'test', 'fragment'].join('-');

function embeddingFetch(dims: number, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: new Array(dims).fill(0.01) }] }), { status })) as unknown as typeof fetch;
}

const signer: WalletSigner = {
  address: ACCOUNT,
  signAndExecuteTransaction: async () => ({ digest: 'd' }),
  signPersonalMessage: async () => ({ signature: 's' }),
};

/** MemWalMock behind the manual surface: same token overlap recall, no relayer. */
class FakeManual implements ManualClient {
  readonly mock = MemWalMock.create({ namespace: 'ferry-core' });
  calls = 0;
  destroyed = false;
  async rememberManual(text: string, namespace?: string) {
    this.calls += 1;
    const res = await this.mock.rememberAndWait(text, namespace ?? 'ferry-core');
    return { blob_id: res.blob_id };
  }
  async recallManual(query: string, options: { limit?: number; namespace?: string }) {
    return this.mock.recall({ query, limit: options.limit ?? 10, namespace: options.namespace ?? 'ferry-core' });
  }
  destroy() {
    this.destroyed = true;
  }
}

describe('verifyEmbeddingDimensions', () => {
  it(`accepts exactly ${EMBEDDING_DIMS} dimensions and rejects everything else`, async () => {
    const ok = embeddingFetch(1536);
    await verifyEmbeddingDimensions({ apiKey: KEY }, ok);
    expect(ok).toHaveBeenCalledWith('https://api.openai.com/v1/embeddings', expect.objectContaining({ method: 'POST' }));
    await expect(verifyEmbeddingDimensions({ apiKey: KEY }, embeddingFetch(768))).rejects.toBeInstanceOf(EmbeddingDimensionError);
    await expect(verifyEmbeddingDimensions({ apiKey: KEY }, embeddingFetch(1536, 401))).rejects.toThrow(/401/);
    const empty = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    await expect(verifyEmbeddingDimensions({ apiKey: KEY }, empty)).rejects.toThrow(/no vector/);
    await expect(verifyEmbeddingDimensions({ apiKey: ' ' }, ok)).rejects.toThrow(/apiKey/);
    await expect(verifyEmbeddingDimensions({ apiKey: KEY, apiBase: 'http://example.com/v1' }, ok)).rejects.toThrow(/https/);
  });

  it('defaults the model per provider', async () => {
    const f = embeddingFetch(1536);
    await verifyEmbeddingDimensions({ apiKey: KEY, apiBase: 'https://openrouter.ai/api/v1/' }, f);
    const body = JSON.parse(String((vi.mocked(f).mock.calls[0]?.[1] as RequestInit).body)) as { model: string };
    expect(body.model).toBe('openai/text-embedding-3-small');
  });
});

describe('FerryVaultMemory', () => {
  async function vault(client: ManualClient = new FakeManual()) {
    return FerryVaultMemory.create({
      seed: SEED,
      accountId: ACCOUNT,
      serverUrl: 'https://relayer.memory.walrus.xyz',
      embedding: { apiKey: KEY },
      walletSigner: signer,
      fetch: embeddingFetch(1536),
      clock: new TestClock(),
      db: freshDb(),
      client,
    });
  }

  it('writes each memory through rememberManual and stores results without polling', async () => {
    const client = new FakeManual();
    const memory = await vault(client);
    const results = await memory.writeFacts([fact({ text: 'Vault fact one' }), fact({ text: 'Vault fact two' })]);
    expect(results.map((r) => r.status)).toEqual(['written', 'written']);
    expect(client.calls).toBe(2);
    expect(memory.governor.levels().key).toBeCloseTo(26 - 6);
  });

  it('recalls with relevance only and hides with a tombstone', async () => {
    const memory = await vault();
    const [r] = await memory.writeFacts([fact({ text: 'Prefers window seats' })]);
    if (r?.status !== 'written') throw new Error('write failed');
    expect((await memory.recallForDraft('window seats', 3)).map((s) => s.ref)).toEqual([r.ref]);
    await memory.hide(r.ref);
    expect(await memory.recallForDraft('window seats', 3)).toEqual([]);
  });

  it('has no listing API, so sync is unsupported', async () => {
    const client = new FakeManual();
    const memory = await vault(client);
    await expect(memory.syncFromWalrus()).rejects.toBeInstanceOf(UnsupportedInModeError);
    memory.destroy();
    expect(client.destroyed).toBe(true);
  });

  it('refuses to start when the embedding model has the wrong size', async () => {
    await expect(
      FerryVaultMemory.create({
        seed: SEED,
        accountId: ACCOUNT,
        serverUrl: 'https://relayer.memory.walrus.xyz',
        embedding: { apiKey: KEY },
        walletSigner: signer,
        fetch: embeddingFetch(3072),
        db: freshDb(),
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionError);
  });

  it('builds a real MemWalManual when no client is injected', async () => {
    const memory = await FerryVaultMemory.create({
      seed: SEED,
      accountId: ACCOUNT,
      serverUrl: 'https://relayer.memory.walrus.xyz',
      embedding: { apiKey: KEY },
      walletSigner: signer,
      fetch: embeddingFetch(1536),
      db: freshDb(),
    });
    memory.destroy();
  });
});

describe('manualSignerConfig', () => {
  it('prefers a wallet signer when a page provides one', () => {
    expect(manualSignerConfig(SEED, signer)).toEqual({ walletSigner: signer });
  });

  it('otherwise signs Seal sessions with the delegate seed itself', () => {
    const config = manualSignerConfig(SEED);
    if (!('suiPrivateKey' in config)) throw new Error('expected a private key config');
    const decoded = decodeSuiPrivateKey(config.suiPrivateKey);
    expect(decoded.scheme).toBe('ED25519');
    expect(Array.from(decoded.secretKey)).toEqual(Array.from(SEED));
    expect(() => manualSignerConfig(new Uint8Array(4))).toThrow(/32 bytes/);
  });
});
