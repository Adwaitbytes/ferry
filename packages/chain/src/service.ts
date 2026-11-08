import { CreditMeter, type MeterSnapshot } from './meter.js';
import { ChainReaders } from './readers.js';
import { PriceFeed } from './price.js';
import { TatumSui, type SuiRpc } from './rpc.js';
import { createTatumGrpcClient, tatumApiKeyFromEnv, tatumGrpcHost } from './tatum.js';
import { verifyUsdcPayment, type PaymentVerification, type VerifyUsdcPaymentInput } from './payment.js';
import { relaySignedTransaction, type RelayResult } from './allowlist.js';

/** Everything the server needs from the chain, sharing one rate limit and one credit meter. */
export interface ChainService {
  sui: TatumSui;
  readers: ChainReaders;
  prices: PriceFeed;
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

export function createChainService(options: { rpc: SuiRpc; apiKey: string; prices?: PriceFeed; meter?: CreditMeter }): ChainService {
  const meter = options.meter ?? new CreditMeter();
  const sui = new TatumSui({ rpc: options.rpc, meter });
  const readers = new ChainReaders(sui);
  const prices = options.prices ?? new PriceFeed({ apiKey: options.apiKey, meter });
  return {
    sui,
    readers,
    prices,
    getMeter: () => meter.snapshot(),
    readAccount: (accountId) => readers.readAccount(accountId),
    readAccountByOwner: (owner) => readers.readAccountByOwner(owner),
    findAccountByOwner: (owner) => readers.findAccountByOwner(owner),
    readBlob: (id, opts) => readers.readBlob(id, opts),
    currentEpoch: () => readers.currentEpoch(),
    getUsdPrice: (symbol) => prices.getUsdPrice(symbol),
    verifyUsdcPayment: (input) => verifyUsdcPayment(sui, input),
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
    const apiKey = tatumApiKeyFromEnv(env);
    shared = createChainService({ rpc: createTatumGrpcClient({ apiKey, host: tatumGrpcHost(env) }), apiKey });
  }
  return shared;
}

/** Test hook: drop the singleton so a new environment is read. */
export function resetChainService(): void {
  shared = undefined;
}
