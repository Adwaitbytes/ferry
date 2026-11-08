import { describe, expect, it, vi } from 'vitest';
import { PriceFeed, PRICE_TTL_MS, UpstreamHttpError, type FetchLike } from './price.js';
import { CreditMeter } from './meter.js';
import { ChainDataError } from './rpc.js';
import { fakeClock } from './fixtures.testutil.js';

const KEY = ['test', 'key', 'value'].join('-');

function feed(responses: { ok: boolean; status: number; body?: unknown }[]) {
  const clock = fakeClock();
  const meter = new CreditMeter(0);
  const fetch = vi.fn<FetchLike>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return { ok: next.ok, status: next.status, json: async () => next.body };
  });
  return { prices: new PriceFeed({ apiKey: KEY, fetch, meter, clock }), fetch, meter, clock };
}

const SUI = { value: '3.21', basePair: 'USD', timestamp: 1794312000000, source: 'CoinGecko', symbol: 'SUI' };

describe('PriceFeed', () => {
  it('calls the Tatum rate endpoint with the key header and USD base pair', async () => {
    const { prices, fetch, meter } = feed([{ ok: true, status: 200, body: SUI }]);
    expect(await prices.getUsdPrice(' sui ')).toEqual({ symbol: 'SUI', usd: '3.21', timestampMs: 1794312000000, source: 'CoinGecko' });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.tatum.io/v4/data/rate/symbol?symbol=SUI&basePair=USD');
    expect(init?.headers['x-api-key']).toBe(KEY);
    expect(meter.snapshot().methods['RateBySymbol']).toMatchObject({ calls: 1, credits: 20 });
  });

  it('caches each symbol for 60 s', async () => {
    const { prices, fetch, meter, clock } = feed([
      { ok: true, status: 200, body: SUI },
      { ok: true, status: 200, body: { ...SUI, value: '3.30', source: undefined } },
    ]);
    await prices.getUsdPrice('SUI');
    await prices.getUsdPrice('SUI');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(meter.snapshot().methods['RateBySymbol']?.cacheHits).toBe(1);
    clock.advance(PRICE_TTL_MS);
    expect(await prices.getUsdPrice('SUI')).toMatchObject({ usd: '3.30', source: null });
  });

  it('retries 429 and surfaces other HTTP errors without the body', async () => {
    const { prices } = feed([
      { ok: false, status: 429 },
      { ok: true, status: 200, body: SUI },
    ]);
    expect((await prices.getUsdPrice('SUI')).usd).toBe('3.21');
    const { prices: denied, meter } = feed([{ ok: false, status: 401, body: { message: KEY } }]);
    const error = await denied.getUsdPrice('SUI').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamHttpError);
    expect((error as Error).message).toBe('upstream responded 401');
    expect(meter.snapshot().methods['RateBySymbol']?.errors).toBe(1);
  });

  it('rejects unexpected shapes and wrong base pairs', async () => {
    const { prices } = feed([{ ok: true, status: 200, body: { value: 'NaN', basePair: 'USD', timestamp: 1 } }]);
    await expect(prices.getUsdPrice('SUI')).rejects.toThrow(ChainDataError);
    const { prices: eur } = feed([{ ok: true, status: 200, body: { ...SUI, basePair: 'EUR' } }]);
    await expect(eur.getUsdPrice('SUI')).rejects.toThrow(ChainDataError);
  });

  it('validates the symbol before any request', async () => {
    const { prices, fetch } = feed([]);
    await expect(prices.getUsdPrice('../admin')).rejects.toThrow();
    await expect(prices.getUsdPrice('A')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults to global fetch', () => {
    expect(new PriceFeed({ apiKey: KEY })).toBeInstanceOf(PriceFeed);
  });
});
