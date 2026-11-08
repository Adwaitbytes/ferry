import { z } from 'zod';
import { TATUM_API_BASE } from './constants.js';
import { TtlCache } from './cache.js';
import { systemClock, type Clock } from './clock.js';
import { CreditMeter, ESTIMATED_CREDITS } from './meter.js';
import { withRetry } from './retry.js';
import { ChainDataError } from './rpc.js';

export const PRICE_TTL_MS = 60_000;

/** Tatum symbols are short uppercase tickers; anything else never reaches the upstream URL. */
export const PriceSymbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/);

const RateResponse = z.object({
  value: z
    .string()
    .regex(/^[0-9][0-9.eE+-]{0,39}$/)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0),
  basePair: z.string(),
  timestamp: z.number(),
  source: z.string().optional(),
});

export interface UsdPrice {
  symbol: string;
  /** Decimal string exactly as Tatum returned it; never parsed to float for money math. */
  usd: string;
  timestampMs: number;
  source: string | null;
}

export class UpstreamHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`upstream responded ${status}`);
    this.name = 'UpstreamHttpError';
    this.status = status;
  }
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface PriceFeedOptions {
  apiKey: string;
  fetch?: FetchLike;
  meter?: CreditMeter;
  clock?: Clock;
  timeoutMs?: number;
}

/** Tatum `GET /v4/data/rate/symbol` with a 60 s cache (RESEARCH 2.4: 20 credits per call). */
export class PriceFeed {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #meter: CreditMeter;
  readonly #clock: Clock;
  readonly #timeoutMs: number;
  readonly #cache: TtlCache<UsdPrice>;

  constructor(options: PriceFeedOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#clock = options.clock ?? systemClock;
    this.#meter = options.meter ?? new CreditMeter(this.#clock.now());
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#cache = new TtlCache({ clock: this.#clock, maxEntries: 64 });
  }

  async getUsdPrice(symbol: string): Promise<UsdPrice> {
    const ticker = PriceSymbol.parse(symbol);
    const { value, hit } = await this.#cache.getOrLoad(ticker, PRICE_TTL_MS, () => this.#load(ticker));
    if (hit) this.#meter.cacheHit('RateBySymbol');
    return value;
  }

  async #load(ticker: string): Promise<UsdPrice> {
    const url = new URL('/v4/data/rate/symbol', TATUM_API_BASE);
    url.searchParams.set('symbol', ticker);
    url.searchParams.set('basePair', 'USD');
    return withRetry(
      async () => {
        const response = await this.#fetch(url.toString(), {
          headers: { 'x-api-key': this.#apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (!response.ok) {
          this.#meter.error('RateBySymbol');
          throw new UpstreamHttpError(response.status);
        }
        this.#meter.call('RateBySymbol', ESTIMATED_CREDITS.rate);
        const parsed = RateResponse.safeParse(await response.json());
        if (!parsed.success || parsed.data.basePair.toUpperCase() !== 'USD') {
          throw new ChainDataError('unexpected rate response');
        }
        return {
          symbol: ticker,
          usd: parsed.data.value,
          timestampMs: parsed.data.timestamp,
          source: parsed.data.source ?? null,
        };
      },
      { clock: this.#clock, onRetry: () => this.#meter.retry('RateBySymbol') },
    );
  }
}
