import { MemWalMock } from '@mysten-incubation/memwal';
import type {
  ListMemoriesOptions,
  MemoriesResult,
  RecallParams,
  RecallResult,
  RememberAcceptedResult,
  RememberBulkAcceptedResult,
  RememberBulkAsyncOptions,
  RememberBulkItem,
  RememberBulkStatusResult,
  RememberOptions,
} from '@mysten-incubation/memwal';
import type { CandidateFact, FactType, Receipt, Vendor } from '@ferry/core';
import { FerryDb } from '../db.js';
import type { RelayerClient } from '../transport.js';
import type { Clock } from '../types.js';

export type Op = 'remember' | 'bulk' | 'status' | 'recall' | 'list';

export interface StoredBlob {
  blobId: string;
  namespace: string;
  text: string;
  createdAt: string;
  memoryId: string;
}

/** Error shaped like `signedRequest` in dist/memwal.js builds it. */
export function httpError(status: number, serverCode?: string, retryAfterSeconds?: number): Error {
  const err = new Error(`HTTP ${status}`) as Error & { status: number; serverCode?: string; retryAfterSeconds?: number };
  err.status = status;
  if (serverCode !== undefined) err.serverCode = serverCode;
  if (retryAfterSeconds !== undefined) err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

/**
 * The SDK's `MemWalMock` (deterministic, token overlap recall) plus what it lacks for Ferry:
 * `listMemories`, `created_at` on recall hits, failure injection and call accounting.
 */
export class FakeRelayer implements RelayerClient {
  readonly mock = MemWalMock.create({ namespace: 'ferry-core' });
  readonly calls: Record<Op, number> = { remember: 0, bulk: 0, status: 0, recall: 0, list: 0 };
  readonly bulkSizes: number[] = [];
  readonly keys: string[] = [];
  readonly blobs = new Map<string, StoredBlob>();
  private readonly failures: Array<{ op: Op; error: Error }> = [];
  /** Status polls that report `running` before the mock's `done`. */
  runningPolls = 0;
  /** Recall calls that return nothing, to simulate index lag. */
  emptyRecalls = 0;
  /** Scripted listMemories pages; when empty a single page is built from `blobs`. */
  readonly pages: MemoriesResult[] = [];
  readonly listOptions: ListMemoriesOptions[] = [];
  destroyed = false;
  private seq = 0;

  constructor(private readonly clock: Clock) {}

  failNext(op: Op, error: Error, times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push({ op, error });
  }

  private maybeFail(op: Op): void {
    this.calls[op] += 1;
    const i = this.failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      if (f) throw f.error;
    }
  }

  private async track(jobIds: string[]): Promise<void> {
    const status = await this.mock.getRememberBulkStatus(jobIds);
    for (const s of status.results) {
      if (!s.blob_id || this.blobs.has(s.blob_id)) continue;
      this.seq += 1;
      const recalled = await this.mock.recall({ query: 'x', limit: 1000, namespace: s.namespace ?? 'ferry-core' });
      const text = recalled.results.find((r) => r.blob_id === s.blob_id)?.text ?? '';
      this.blobs.set(s.blob_id, {
        blobId: s.blob_id,
        namespace: s.namespace ?? 'ferry-core',
        text,
        createdAt: new Date(this.clock.now()).toISOString(),
        memoryId: `mem-${this.seq}`,
      });
    }
  }

  /** Puts a memory on "Walrus" as if another device wrote it. */
  async seed(text: string, namespace = 'ferry-core'): Promise<string> {
    const accepted = await this.mock.remember(text, namespace);
    await this.track([accepted.job_id]);
    const status = await this.mock.getRememberBulkStatus([accepted.job_id]);
    return status.results[0]?.blob_id ?? '';
  }

  async remember(text: string, namespace: string, options: RememberOptions): Promise<RememberAcceptedResult> {
    this.maybeFail('remember');
    if (options.idempotencyKey) this.keys.push(options.idempotencyKey);
    const accepted = await this.mock.remember(text, namespace, options);
    await this.track([accepted.job_id]);
    return accepted;
  }

  async rememberBulk(items: RememberBulkItem[], options: RememberBulkAsyncOptions): Promise<RememberBulkAcceptedResult> {
    this.maybeFail('bulk');
    this.bulkSizes.push(items.length);
    if (options.idempotencyKey) this.keys.push(options.idempotencyKey);
    const accepted = await this.mock.rememberBulk(items, options);
    await this.track(accepted.job_ids);
    return accepted;
  }

  async getRememberBulkStatus(jobIds: string[]): Promise<RememberBulkStatusResult> {
    this.maybeFail('status');
    if (this.runningPolls > 0) {
      this.runningPolls -= 1;
      return { results: jobIds.map((job_id) => ({ job_id, status: 'running' as const })) };
    }
    return this.mock.getRememberBulkStatus(jobIds);
  }

  async recall(params: RecallParams): Promise<RecallResult> {
    this.maybeFail('recall');
    if (this.emptyRecalls > 0) {
      this.emptyRecalls -= 1;
      return { results: [], total: 0 };
    }
    const res = await this.mock.recall(params);
    return {
      ...res,
      results: res.results.map((r) => {
        const createdAt = this.blobs.get(r.blob_id)?.createdAt;
        return createdAt ? { ...r, created_at: createdAt } : r;
      }),
    };
  }

  async listMemories(options: ListMemoriesOptions): Promise<MemoriesResult> {
    this.maybeFail('list');
    this.listOptions.push(options);
    const scripted = this.pages.shift();
    if (scripted) return scripted;
    return {
      memories: [...this.blobs.values()].map((b) => ({
        memory_id: b.memoryId,
        namespace_id: b.namespace,
        blob_id: b.blobId,
        created_at: b.createdAt,
        updated_at: b.createdAt,
        size: b.text.length,
        agent_id: null,
        package_id: null,
        status: 'active',
        end_epoch: 1400,
        expires_at: '2027-06-01T00:00:00Z',
        importance: null,
      })),
      next_cursor: 'cursor-end',
      has_more: false,
      snapshot_version: 1,
      deleted: [],
      must_resync: false,
    };
  }

  forgetMemory(blobId: string): void {
    this.blobs.delete(blobId);
    this.mock.forget(blobId);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** Time only moves when someone sleeps, so pacing and backoff are exact and instant. */
export class TestClock implements Clock {
  readonly sleeps: number[] = [];
  constructor(public t: number = Date.parse('2026-11-09T12:00:00Z')) {}
  now(): number {
    return this.t;
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.sleeps.push(ms);
    this.t += Math.max(0, ms);
    return Promise.resolve();
  }
}

let dbCounter = 0;
export function freshDb(name?: string): FerryDb {
  dbCounter += 1;
  return new FerryDb(name ?? `test-db-${dbCounter}-${Math.random().toString(36).slice(2)}`);
}

let hashCounter = 0;
function shortHash(): string {
  hashCounter += 1;
  return `h${hashCounter.toString().padStart(11, '0')}`;
}

export interface FactInit {
  text: string;
  type?: FactType;
  vendor?: Vendor;
  messageAt?: string;
  confidence?: number;
  receipts?: Receipt[];
  sensitive?: CandidateFact['sensitive'];
  flags?: CandidateFact['flags'];
}

export function receipt(vendor: Vendor = 'chatgpt', messageAt = '2026-10-12T09:30:00Z', confidence = 0.9): Receipt {
  return {
    vendor,
    conversationIdHash: shortHash(),
    conversationUrl: 'https://chatgpt.com/c/abc',
    messageAt,
    quote: 'I am vegetarian',
    quoteHash: shortHash(),
    confidence,
  };
}

export function fact(init: FactInit): CandidateFact {
  return {
    id: globalThis.crypto.randomUUID(),
    text: init.text,
    type: init.type ?? 'preference',
    receipts: init.receipts ?? [receipt(init.vendor, init.messageAt, init.confidence)],
    sensitive: init.sensitive ?? [],
    flags: init.flags ?? [],
  };
}

export const ACCOUNT = `0x${'ab'.repeat(32)}`;
export const SEED = new Uint8Array(32).fill(7);
