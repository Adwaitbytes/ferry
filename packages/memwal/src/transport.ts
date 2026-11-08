import type {
  ListMemoriesOptions,
  MemoriesResult,
  RecallMemory,
  RecallParams,
  RecallResult,
  RememberAcceptedResult,
  RememberBulkAcceptedResult,
  RememberBulkAsyncOptions,
  RememberBulkItem,
  RememberBulkStatusItem,
  RememberBulkStatusResult,
  RememberOptions,
} from '@mysten-incubation/memwal';
import type { RateGovernor, RunOptions } from './governor.js';

/** The slice of `MemWal` Ferry uses. `MemWal` satisfies it; tests pass a fake. */
export interface RelayerClient {
  remember(text: string, namespace: string, options: RememberOptions): Promise<RememberAcceptedResult>;
  rememberBulk(items: RememberBulkItem[], options: RememberBulkAsyncOptions): Promise<RememberBulkAcceptedResult>;
  getRememberBulkStatus(jobIds: string[]): Promise<RememberBulkStatusResult>;
  recall(params: RecallParams): Promise<RecallResult>;
  listMemories(options: ListMemoriesOptions): Promise<MemoriesResult>;
  destroy(): void;
}

export type SubmitResult = { kind: 'jobs'; jobIds: string[] } | { kind: 'stored'; blobIds: string[] };

export interface RecallRequest {
  query: string;
  limit: number;
  namespace: string;
  sort: 'relevance' | 'recent';
}

/** How the engine reaches Walrus Memory. Every implementation spends points through the governor. */
export interface MemoryTransport {
  readonly mode: 'standard' | 'vault';
  /** Whether `recall` honors `sort: "recent"`. */
  readonly supportsRecent: boolean;
  submit(namespace: string, texts: string[], idempotencyKey: string, opts: RunOptions): Promise<SubmitResult>;
  status(jobIds: string[], opts: RunOptions): Promise<RememberBulkStatusItem[]>;
  recall(req: RecallRequest, opts: RunOptions): Promise<RecallMemory[]>;
  /** Null when the mode has no listing API. */
  list(options: ListMemoriesOptions, opts: RunOptions): Promise<MemoriesResult> | null;
  destroy(): void;
}

export class RelayerTransport implements MemoryTransport {
  readonly mode = 'standard';
  readonly supportsRecent = true;

  constructor(
    private readonly client: RelayerClient,
    private readonly governor: RateGovernor,
  ) {}

  async submit(namespace: string, texts: string[], idempotencyKey: string, opts: RunOptions): Promise<SubmitResult> {
    // A single remember costs 5 points, a bulk 10 whatever its size, so one item goes single.
    const [only] = texts;
    if (texts.length === 1 && only !== undefined) {
      const accepted = await this.governor.run('remember', () => this.client.remember(only, namespace, { idempotencyKey }), opts);
      return { kind: 'jobs', jobIds: [accepted.job_id] };
    }
    const accepted = await this.governor.run(
      'bulk',
      () => this.client.rememberBulk(texts.map((text) => ({ text, namespace })), { idempotencyKey }),
      opts,
    );
    return { kind: 'jobs', jobIds: accepted.job_ids };
  }

  async status(jobIds: string[], opts: RunOptions): Promise<RememberBulkStatusItem[]> {
    const res = await this.governor.run('status', () => this.client.getRememberBulkStatus(jobIds), opts);
    return res.results;
  }

  async recall(req: RecallRequest, opts: RunOptions): Promise<RecallMemory[]> {
    const res = await this.governor.run('recall', () => this.client.recall({ query: req.query, limit: req.limit, namespace: req.namespace, sort: req.sort }), opts);
    return res.results;
  }

  list(options: ListMemoriesOptions, opts: RunOptions): Promise<MemoriesResult> {
    return this.governor.run('list', () => this.client.listMemories(options), opts);
  }

  destroy(): void {
    this.client.destroy();
  }
}
