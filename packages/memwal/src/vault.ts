import { MemWalManual, type RecallManualMemory, type WalletSigner } from '@mysten-incubation/memwal/manual';
import type { MemoriesResult, RecallMemory, RememberBulkStatusItem } from '@mysten-incubation/memwal';
import { FerryDb, dbNameForAccount, type FerryDbOptions } from './db.js';
import { MemoryEngine, type EngineOptions } from './engine.js';
import { RateGovernor, type GovernorConfig, type RunOptions } from './governor.js';
import { LocalIndex } from './local-index.js';
import { assertConfig } from './memory.js';
import type { MemoryTransport, RecallRequest, SubmitResult } from './transport.js';
import { systemClock, type Clock } from './types.js';

/** Mainnet MemWal package and registry (RESEARCH 1.1, verified against relayer /config). */
export const MEMWAL_PACKAGE_ID = '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5';
export const MEMWAL_REGISTRY_ID = '0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f';
/** The relayer rejects any other length (`EMBEDDING_DIMS = 1536`, RESEARCH 1.1). */
export const EMBEDDING_DIMS = 1536;

export interface EmbeddingConfig {
  /** The user's own key (BYOK). Never logged, never sent anywhere but `apiBase`. */
  apiKey: string;
  apiBase?: string;
  model?: string;
}

/** The slice of `MemWalManual` Ferry uses. */
export interface ManualClient {
  rememberManual(text: string, namespace?: string): Promise<{ blob_id: string }>;
  recallManual(query: string, options: { limit?: number; namespace?: string }): Promise<{ results: RecallManualMemory[] }>;
  destroy(): void;
}

export class EmbeddingDimensionError extends Error {
  override readonly name = 'EmbeddingDimensionError';
  constructor(readonly got: number) {
    super(`The embedding endpoint returned ${got} dimensions; Walrus Memory requires exactly ${EMBEDDING_DIMS}.`);
  }
}

function embeddingDefaults(config: EmbeddingConfig): Required<EmbeddingConfig> {
  const apiBase = (config.apiBase ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (new URL(apiBase).protocol !== 'https:') throw new TypeError('embedding apiBase must be https');
  // OpenRouter namespaces model ids by vendor; the SDK applies the same default (dist/manual.js embed).
  const model = config.model ?? (apiBase.includes('openrouter.ai') ? 'openai/text-embedding-3-small' : 'text-embedding-3-small');
  return { apiKey: config.apiKey, apiBase, model };
}

/**
 * The SDK embeds without checking length and the relayer rejects anything but 1536 only after
 * the SEAL encrypt and Walrus upload. One probe up front turns a wrong model into a clear error.
 */
export async function verifyEmbeddingDimensions(config: EmbeddingConfig, fetchImpl: typeof fetch = globalThis.fetch): Promise<void> {
  const { apiKey, apiBase, model } = embeddingDefaults(config);
  if (apiKey.trim().length === 0) throw new TypeError('embedding apiKey is required');
  const res = await fetchImpl(`${apiBase}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: 'ferry dimension probe' }),
  });
  if (!res.ok) throw new Error(`Embedding endpoint answered ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
  const vector = body.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error('Embedding endpoint returned no vector');
  if (vector.length !== EMBEDDING_DIMS) throw new EmbeddingDimensionError(vector.length);
}

/**
 * Vault transport: the SDK embeds and SEAL-encrypts on this device, so the relayer never sees
 * plaintext (it still sees vectors, owner, namespace and access pattern; PRD F10). There is no
 * bulk or job API in manual mode, so each memory is one `/api/remember/manual` call (3 points),
 * there is no idempotency key, and there is no listing.
 */
export class ManualTransport implements MemoryTransport {
  readonly mode = 'vault';
  readonly supportsRecent = false;

  constructor(
    private readonly client: ManualClient,
    private readonly governor: RateGovernor,
  ) {}

  async submit(namespace: string, texts: string[], _idempotencyKey: string, opts: RunOptions): Promise<SubmitResult> {
    const blobIds: string[] = [];
    for (const text of texts) {
      const res = await this.governor.run('manual', () => this.client.rememberManual(text, namespace), opts);
      blobIds.push(res.blob_id);
    }
    return { kind: 'stored', blobIds };
  }

  status(): Promise<RememberBulkStatusItem[]> {
    return Promise.resolve([]);
  }

  async recall(req: RecallRequest, opts: RunOptions): Promise<RecallMemory[]> {
    const res = await this.governor.run('recall', () => this.client.recallManual(req.query, { limit: req.limit, namespace: req.namespace }), opts);
    return res.results;
  }

  list(): Promise<MemoriesResult> | null {
    return null;
  }

  destroy(): void {
    this.client.destroy();
  }
}

export interface FerryVaultMemoryConfig {
  seed: Uint8Array;
  accountId: string;
  serverUrl: string;
  embedding: EmbeddingConfig;
  /** Wallet signer from the web app or side panel; one popup per session for the SEAL key. */
  walletSigner: WalletSigner;
  clock?: Clock;
  random?: () => number;
  governor?: RateGovernor;
  governorConfig?: Partial<GovernorConfig>;
  db?: FerryDb;
  dbOptions?: FerryDbOptions;
  fetch?: typeof fetch;
  client?: ManualClient;
  engine?: Omit<EngineOptions, 'clock' | 'random'>;
}

/** Vault mode (PRD F10, P1). Same surface as `FerryMemory` except `syncFromWalrus`. */
export class FerryVaultMemory extends MemoryEngine {
  private constructor(transport: ManualTransport, index: LocalIndex, governor: RateGovernor, options: EngineOptions) {
    super(transport, index, governor, options);
  }

  static async create(config: FerryVaultMemoryConfig): Promise<FerryVaultMemory> {
    assertConfig(config.seed, config.accountId, config.serverUrl);
    const embedding = embeddingDefaults(config.embedding);
    await verifyEmbeddingDimensions(embedding, config.fetch);
    const clock = config.clock ?? systemClock;
    const governor = config.governor ?? new RateGovernor(config.governorConfig, clock, config.random);
    const client =
      config.client ??
      MemWalManual.create({
        key: config.seed,
        accountId: config.accountId,
        serverUrl: config.serverUrl,
        walletSigner: config.walletSigner,
        embeddingApiKey: embedding.apiKey,
        embeddingApiBase: embedding.apiBase,
        embeddingModel: embedding.model,
        packageId: MEMWAL_PACKAGE_ID,
        registryId: MEMWAL_REGISTRY_ID,
        suiNetwork: 'mainnet',
        namespace: 'ferry-core',
      });
    const db = config.db ?? new FerryDb(`${dbNameForAccount(config.accountId)}-vault`, config.dbOptions);
    return new FerryVaultMemory(new ManualTransport(client, governor), new LocalIndex(db), governor, {
      ...config.engine,
      clock,
      ...(config.random ? { random: config.random } : {}),
    });
  }
}
