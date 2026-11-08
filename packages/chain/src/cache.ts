import { systemClock, type Clock } from './clock.js';

interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Short-TTL cache with in-flight de-duplication: concurrent readers of the same key share one
 * upstream call, which matters when the upstream budget is 3 requests per second. Failures are
 * never cached.
 */
export class TtlCache<V> {
  readonly #entries = new Map<string, Entry<V>>();
  readonly #inflight = new Map<string, Promise<V>>();
  readonly #maxEntries: number;
  readonly #clock: Clock;

  constructor(options: { maxEntries?: number; clock?: Clock } = {}) {
    this.#maxEntries = options.maxEntries ?? 1000;
    this.#clock = options.clock ?? systemClock;
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#clock.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.#entries.size >= this.#maxEntries && !this.#entries.has(key)) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, expiresAt: this.#clock.now() + ttlMs });
  }

  /** Returns the cached value and whether it was a hit, loading on a miss. */
  async getOrLoad(key: string, ttlMs: number, load: () => Promise<V>): Promise<{ value: V; hit: boolean }> {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, hit: true };
    const pending = this.#inflight.get(key);
    if (pending) return { value: await pending, hit: true };
    const promise = load().then(
      (value) => {
        this.set(key, value, ttlMs);
        return value;
      },
    );
    this.#inflight.set(key, promise);
    try {
      return { value: await promise, hit: false };
    } finally {
      this.#inflight.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
