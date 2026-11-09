import { CreditMeter, type MeterSnapshot } from './meter.js';
import { ChainReaders } from './readers.js';
import { PriceFeed } from './price.js';
import { TatumSui, type SuiRpc } from './rpc.js';
import { USDC_COIN_TYPES, type PaymentNetwork } from './constants.js';
import { createTatumGrpcClient, MissingApiKeyError, suiNetworkFromEnv, tatumApiKeyOrNull, tatumGrpcHost } from './tatum.js';
import { verifyUsdcPayment, type PaymentVerification, type VerifyUsdcPaymentInput } from './payment.js';
import { relaySignedTransaction, type RelayResult } from './allowlist.js';

/** Everything the server needs from the chain, sharing one rate limit and one credit meter. */
export interface ChainService {
  /** Network the gRPC client reads. Payment verification defaults to this network's USDC. */
  network: PaymentNetwork;
  sui: TatumSui;
  readers: ChainReaders;
  prices: PriceFeed | null;
  getMeter(): MeterSnapshot;
  readAccount: ChainReaders['readAccount'];
  readAccountByOwner: ChainReaders['readAccountByOwner'];
  findAccountByOwner: ChainReaders['findAccountByOwner'];
  readBlob: ChainReaders['readBlob'];
  currentEpoch: ChainReaders['currentEpoch'];
  getUsdPrice: PriceFeed['getUsdPrice'];
  verifyUsdcPayment(input: VerifyUsdcPaymentInput): Promise<PaymentVerification>;
  relaySignedTransaction(transactionBytes: Uint8Array, signatures: string[]): Promise<RelayResult>;
}

export function createChainService(options: {
  rpc: SuiRpc;
  apiKey: string | null;
  network?: PaymentNetwork;
  prices?: PriceFeed;
  meter?: CreditMeter;
}): ChainService {
  const network = options.network ?? 'mainnet';
  const meter = options.meter ?? new CreditMeter();
  const sui = new TatumSui({ rpc: options.rpc, meter });
  const readers = new ChainReaders(sui);
  const apiKey = options.apiKey;
  const prices = options.prices ?? (apiKey === null ? null : new PriceFeed({ apiKey, meter }));
  return {
    network,
    sui,
    readers,
    prices,
    getMeter: () => meter.snapshot(),
    readAccount: (accountId) => readers.readAccount(accountId),
    readAccountByOwner: (owner) => readers.readAccountByOwner(owner),
    findAccountByOwner: (owner) => readers.findAccountByOwner(owner),
    readBlob: (id, opts) => readers.readBlob(id, opts),
    currentEpoch: () => readers.currentEpoch(),
    // The Data API has no anonymous plan, so prices need a key; chain reads do not.
    getUsdPrice: (symbol) => (prices ? prices.getUsdPrice(symbol) : Promise.reject(new MissingApiKeyError())),
    verifyUsdcPayment: (input) => verifyUsdcPayment(sui, { ...input, coinType: input.coinType ?? USDC_COIN_TYPES[network] }),
    relaySignedTransaction: (bytes, signatures) => relaySignedTransaction(sui, bytes, signatures),
  };
}

let shared: ChainService | undefined;

/**
 * Process-wide singleton so every route in a warm serverless instance shares one 3 rps budget,
 * one cache and one meter. Cross-instance coordination (Upstash) is a later step.
 */
export function getChainService(env: Readonly<Record<string, string | undefined>> = process.env): ChainService {
  if (!shared) {
    const network = suiNetworkFromEnv(env);
    const apiKey = tatumApiKeyOrNull(env, network);
    shared = createChainService({ rpc: createTatumGrpcClient({ apiKey, host: tatumGrpcHost(env, network), network }), apiKey, network });
  }
  return shared;
}

/** Test hook: drop the singleton so a new environment is read. */
export function resetChainService(): void {
  shared = undefined;
}
