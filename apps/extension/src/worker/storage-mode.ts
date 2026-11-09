import type { EmbeddingSetup, StorageMode, VaultStatus } from '@ferry/core';
import { z } from 'zod';
import type { StorageArea, VaultCrypto, VaultEngineConfig } from './ports';

export const STORAGE_MODE_KEY = 'ferry.storage-mode';
/** HKDF purpose label for the sealed embedding key; binds the blob to this one use. */
export const EMBEDDING_SECRET_PURPOSE = 'vault.embedding';
export const DEFAULT_EMBEDDING_BASE = 'https://api.openai.com/v1';

const ModeRecord = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('standard') }),
  z.object({
    mode: z.literal('vault'),
    apiBase: z.url({ protocol: /^https$/ }).max(200),
    model: z.string().min(1).max(100),
    sealedKey: z.unknown(),
  }),
]);
type ModeRecord = z.infer<typeof ModeRecord>;

/** OpenRouter namespaces model ids by vendor; the MemWal SDK applies the same default. */
export function embeddingDefaults(setup: EmbeddingSetup): Omit<VaultEngineConfig, 'apiKey'> {
  const apiBase = (setup.apiBase ?? DEFAULT_EMBEDDING_BASE).replace(/\/+$/, '');
  const model =
    setup.model ??
    (new URL(apiBase).hostname === 'openrouter.ai'
      ? 'openai/text-embedding-3-small'
      : 'text-embedding-3-small');
  return { apiBase, model };
}

/**
 * Which engine takes new writes. The embedding key is stored only sealed under the delegate seed
 * (memwal `sealSecret`), so it is as unreadable at rest as the seed itself and a content script,
 * which can read `storage.local` but never the open seed, gets nothing usable.
 */
export class StorageModeStore {
  constructor(
    private readonly area: StorageArea,
    private readonly crypto: VaultCrypto,
  ) {}

  async mode(): Promise<StorageMode> {
    return (await this.record()).mode;
  }

  async status(): Promise<VaultStatus> {
    const record = await this.record();
    return {
      mode: record.mode,
      embedding: record.mode === 'vault' ? { apiBase: record.apiBase, model: record.model } : null,
      sealSigner: 'delegate',
    };
  }

  /** The engine config for an open session, or null in Standard mode. */
  async engineConfig(seed: Uint8Array): Promise<VaultEngineConfig | null> {
    const record = await this.record();
    if (record.mode === 'standard') return null;
    const apiKey = await this.crypto.openSecret(seed, EMBEDDING_SECRET_PURPOSE, record.sealedKey);
    return { apiKey, apiBase: record.apiBase, model: record.model };
  }

  async enable(seed: Uint8Array, setup: EmbeddingSetup): Promise<void> {
    const { apiBase, model } = embeddingDefaults(setup);
    const sealedKey = await this.crypto.sealSecret(seed, EMBEDDING_SECRET_PURPOSE, setup.apiKey);
    const record: ModeRecord = { mode: 'vault', apiBase, model, sealedKey };
    await this.area.set(STORAGE_MODE_KEY, ModeRecord.parse(record));
  }

  /** Back to Standard. The sealed key is deleted, not kept around for later. */
  async disable(): Promise<void> {
    await this.area.set(STORAGE_MODE_KEY, { mode: 'standard' } satisfies ModeRecord);
  }

  async snapshot(): Promise<unknown> {
    return this.area.get(STORAGE_MODE_KEY);
  }

  async restore(snapshot: unknown): Promise<void> {
    if (snapshot === undefined) await this.area.remove(STORAGE_MODE_KEY);
    else await this.area.set(STORAGE_MODE_KEY, snapshot);
  }

  private async record(): Promise<ModeRecord> {
    const parsed = ModeRecord.safeParse(await this.area.get(STORAGE_MODE_KEY));
    return parsed.success ? parsed.data : { mode: 'standard' };
  }
}
