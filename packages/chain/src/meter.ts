/**
 * Tatum credit meter for the Proofs page. Credit costs are estimates from Tatum's published
 * prices (docs.tatum.io/docs/rpc-nodes: 2 credits per standard RPC method; reference/getexchangerate:
 * 20 credits per rate call). Tatum does not publish a per-method gRPC price, so the dashboard
 * remains the source of truth; this meter shows what Ferry itself sent.
 */
export const ESTIMATED_CREDITS = {
  grpc: 2,
  rate: 20,
} as const;

export interface MethodMeter {
  calls: number;
  credits: number;
  errors: number;
  retries: number;
  cacheHits: number;
}

export interface MeterSnapshot {
  since: string;
  totalCalls: number;
  totalCredits: number;
  totalCacheHits: number;
  totalErrors: number;
  methods: Record<string, MethodMeter>;
  estimate: true;
}

export class CreditMeter {
  readonly #methods = new Map<string, MethodMeter>();
  #since: number;

  constructor(now: number = Date.now()) {
    this.#since = now;
  }

  #entry(method: string): MethodMeter {
    let entry = this.#methods.get(method);
    if (!entry) {
      entry = { calls: 0, credits: 0, errors: 0, retries: 0, cacheHits: 0 };
      this.#methods.set(method, entry);
    }
    return entry;
  }

  /** One request that reached Tatum and was answered; Tatum bills executed requests. */
  call(method: string, credits: number): void {
    const entry = this.#entry(method);
    entry.calls += 1;
    entry.credits += credits;
  }

  error(method: string): void {
    this.#entry(method).errors += 1;
  }

  retry(method: string): void {
    this.#entry(method).retries += 1;
  }

  cacheHit(method: string): void {
    this.#entry(method).cacheHits += 1;
  }

  snapshot(): MeterSnapshot {
    const methods: Record<string, MethodMeter> = {};
    let totalCalls = 0;
    let totalCredits = 0;
    let totalCacheHits = 0;
    let totalErrors = 0;
    for (const [name, m] of [...this.#methods.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      methods[name] = { ...m };
      totalCalls += m.calls;
      totalCredits += m.credits;
      totalCacheHits += m.cacheHits;
      totalErrors += m.errors;
    }
    return {
      since: new Date(this.#since).toISOString(),
      totalCalls,
      totalCredits,
      totalCacheHits,
      totalErrors,
      methods,
      estimate: true,
    };
  }

  reset(now: number = Date.now()): void {
    this.#methods.clear();
    this.#since = now;
  }
}
