import { ObjectError, TransactionError, type SuiClientTypes } from '@mysten/sui/client';
import type { GrpcCoreClient } from '@mysten/sui/grpc';
import { systemClock, type Clock } from './clock.js';
import { TtlCache } from './cache.js';
import { CreditMeter, ESTIMATED_CREDITS, type MeterSnapshot } from './meter.js';
import { TokenBucket } from './limiter.js';
import { withRetry, type RetryOptions } from './retry.js';
import { normalizeAddress } from './address.js';

/**
 * The exact surface Ferry uses from `SuiGrpcClient`. Tests mock this boundary; production passes
 * the real client (it satisfies the interface structurally). `getEpoch` is the raw LedgerService
 * call because `core.getCurrentSystemState` asks for the full system state, which is far larger
 * than the one number Ferry needs.
 */
export interface SuiRpc {
  core: Pick<
    GrpcCoreClient,
    'getObjects' | 'getTransaction' | 'listTransactions' | 'getBalance' | 'executeTransaction' | 'simulateTransaction'
  >;
  ledgerService: {
    getEpoch(input: { epoch?: bigint }): PromiseLike<{ response: { epoch?: { epoch?: bigint } } }>;
  };
}

export type ObjectWithContent = SuiClientTypes.Object<{ content: true }>;
export type PaymentTransaction = SuiClientTypes.Transaction<{ balanceChanges: true; transaction: true }>;

export const CACHE_TTL_MS = {
  object: 15_000,
  epoch: 60_000,
  /** Checkpointed transactions are immutable; the TTL only bounds memory. */
  finalizedTransaction: 300_000,
} as const;

export interface TatumSuiOptions {
  rpc: SuiRpc;
  /** Upstream budget. Defaults to Tatum's free plan: 3 requests per second. */
  ratePerSec?: number;
  maxQueueWaitMs?: number;
  meter?: CreditMeter;
  clock?: Clock;
  retry?: Omit<RetryOptions, 'clock' | 'onRetry'>;
}

/**
 * Paced, retried, cached and metered access to Sui through Tatum. Every upstream call goes
 * through `#call`, so no code path can bypass the rate limit or the meter.
 */
export class TatumSui {
  readonly #rpc: SuiRpc;
  readonly #bucket: TokenBucket;
  readonly #meter: CreditMeter;
  readonly #clock: Clock;
  readonly #retry: Omit<RetryOptions, 'clock' | 'onRetry'>;
  readonly #objects: TtlCache<ObjectWithContent | null>;
  readonly #transactions: TtlCache<PaymentTransaction | null>;
  readonly #epochs: TtlCache<bigint>;

  constructor(options: TatumSuiOptions) {
    this.#rpc = options.rpc;
    this.#clock = options.clock ?? systemClock;
    const rate = options.ratePerSec ?? 3;
    this.#bucket = new TokenBucket({
      ratePerSec: rate,
      capacity: 1,
      maxWaitMs: options.maxQueueWaitMs ?? 10_000,
      clock: this.#clock,
    });
    this.#meter = options.meter ?? new CreditMeter(this.#clock.now());
    this.#retry = options.retry ?? {};
    this.#objects = new TtlCache({ clock: this.#clock, maxEntries: 2000 });
    this.#transactions = new TtlCache({ clock: this.#clock, maxEntries: 2000 });
    this.#epochs = new TtlCache({ clock: this.#clock, maxEntries: 4 });
  }

  get meter(): CreditMeter {
    return this.#meter;
  }

  getMeter(): MeterSnapshot {
    return this.#meter.snapshot();
  }

  async #call<T>(method: string, fn: () => Promise<T>): Promise<T> {
    return withRetry(
      async () => {
        await this.#bucket.take();
        try {
          const result = await fn();
          this.#meter.call(method, ESTIMATED_CREDITS.grpc);
          return result;
        } catch (error) {
          this.#meter.error(method);
          throw error;
        }
      },
      { ...this.#retry, clock: this.#clock, onRetry: () => this.#meter.retry(method) },
    );
  }

  async #cached<V>(cache: TtlCache<V>, method: string, key: string, ttlMs: number, load: () => Promise<V>): Promise<V> {
    const { value, hit } = await cache.getOrLoad(key, ttlMs, load);
    if (hit) this.#meter.cacheHit(method);
    return value;
  }

  /** BatchGetObjects. Missing or deleted objects come back as `null`, in input order. */
  async getObjects(objectIds: readonly string[]): Promise<(ObjectWithContent | null)[]> {
    if (objectIds.length === 0) return [];
    const ids = objectIds.map(normalizeAddress);
    const { objects } = await this.#call('BatchGetObjects', () =>
      this.#rpc.core.getObjects({ objectIds: ids, include: { content: true } }),
    );
    return objects.map((object) => {
      if (object instanceof ObjectError && (object.reason === 'notFound' || object.reason === 'deleted')) return null;
      if (object instanceof Error) throw object;
      return object;
    });
  }

  /** GetObject with a 15 s cache. */
  async getObject(objectId: string, ttlMs: number = CACHE_TTL_MS.object): Promise<ObjectWithContent | null> {
    const id = normalizeAddress(objectId);
    return this.#cached(this.#objects, 'GetObject', id, ttlMs, async () => {
      const [object] = await this.getObjects([id]);
      return object ?? null;
    });
  }

  /**
   * GetTransaction with balance changes and sender. Only checkpointed results are cached, so a
   * pending payment is re-read on the next attempt.
   */
  async getTransaction(digest: string): Promise<PaymentTransaction | null> {
    const cached = this.#transactions.get(digest);
    if (cached !== undefined) {
      this.#meter.cacheHit('GetTransaction');
      return cached;
    }
    let result: PaymentTransaction | null;
    try {
      const response = await this.#call('GetTransaction', () =>
        this.#rpc.core.getTransaction({ digest, include: { balanceChanges: true, transaction: true } }),
      );
      result = response.Transaction ?? response.FailedTransaction;
    } catch (error) {
      if (error instanceof TransactionError && error.reason === 'notFound') return null;
      throw error;
    }
    if (result.checkpoint !== null) this.#transactions.set(digest, result, CACHE_TTL_MS.finalizedTransaction);
    return result;
  }

  /**
   * ListTransactions for an address's history. The gRPC filter matches the sender only; incoming
   * transfers to an address are not indexed by Sui RPC, so Gate verifies by digest instead.
   */
  async listTransactionsBySender(
    sender: string,
    options: { limit?: number; before?: string | null } = {},
  ): Promise<SuiClientTypes.ListTransactionsResponse<{ balanceChanges: true }>> {
    const input: SuiClientTypes.ListTransactionsOptions<{ balanceChanges: true }> = {
      filter: { sender: normalizeAddress(sender) },
      order: 'descending',
      limit: Math.min(Math.max(options.limit ?? 20, 1), 50),
      include: { balanceChanges: true },
    };
    if (options.before) input.before = options.before;
    return this.#call('ListTransactions', () => this.#rpc.core.listTransactions(input));
  }

  /** Current Sui epoch via LedgerService.GetEpoch (default read mask is the epoch number only). */
  async getSuiEpoch(): Promise<bigint> {
    return this.#cached(this.#epochs, 'GetEpoch', 'sui', CACHE_TTL_MS.epoch, async () => {
      const { response } = await this.#call('GetEpoch', async () => this.#rpc.ledgerService.getEpoch({}));
      const epoch = response.epoch?.epoch;
      if (epoch === undefined) throw new ChainDataError('GetEpoch returned no epoch');
      return epoch;
    });
  }

  async getBalance(owner: string, coinType: string): Promise<SuiClientTypes.Balance> {
    const { balance } = await this.#call('GetBalance', () =>
      this.#rpc.core.getBalance({ owner: normalizeAddress(owner), coinType }),
    );
    return balance;
  }

  /** ExecuteTransaction for already-signed bytes. Callers must apply the X-CHP-1 allowlist first. */
  async executeTransaction(
    transaction: Uint8Array,
    signatures: string[],
  ): Promise<SuiClientTypes.TransactionResult<{ balanceChanges: true; effects: true }>> {
    return this.#call('ExecuteTransaction', () =>
      this.#rpc.core.executeTransaction({ transaction, signatures, include: { balanceChanges: true, effects: true } }),
    );
  }

  async simulateTransaction(
    transaction: Uint8Array,
  ): Promise<SuiClientTypes.SimulateTransactionResult<{ balanceChanges: true; effects: true }>> {
    return this.#call('SimulateTransaction', () =>
      this.#rpc.core.simulateTransaction({ transaction, include: { balanceChanges: true, effects: true } }),
    );
  }
}

/** Upstream returned something that does not match the expected on-chain shape. */
export class ChainDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainDataError';
  }
}
