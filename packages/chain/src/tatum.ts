import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { PAYMENT_NETWORKS, TATUM_SUI_GRPC_HOSTS, type PaymentNetwork } from './constants.js';

type Env = Readonly<Record<string, string | undefined>>;

export class MissingApiKeyError extends Error {
  constructor() {
    super('TATUM_API_KEY is not set');
    this.name = 'MissingApiKeyError';
  }
}

/** Reads the key from the environment only, so it can never arrive through a request. */
export function tatumApiKeyFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const key = env['TATUM_API_KEY']?.trim();
  if (!key) throw new MissingApiKeyError();
  return key;
}

/**
 * The key if configured, else null for Tatum's anonymous plan (heavily rate limited). Tatum
 * issues separate Testnet keys, so testnet prefers TATUM_API_KEY_TESTNET.
 */
export function tatumApiKeyOrNull(env: Env = process.env, network: PaymentNetwork = 'mainnet'): string | null {
  if (network === 'testnet') return env['TATUM_API_KEY_TESTNET']?.trim() || env['TATUM_API_KEY']?.trim() || null;
  return env['TATUM_API_KEY']?.trim() || null;
}

/** SUI_NETWORK, default mainnet. Anything else is a configuration error, not a silent fallback. */
export function suiNetworkFromEnv(env: Env = process.env): PaymentNetwork {
  const raw = env['SUI_NETWORK']?.trim().toLowerCase();
  if (!raw) return 'mainnet';
  const network = PAYMENT_NETWORKS.find((candidate) => candidate === raw);
  if (!network) throw new TypeError('SUI_NETWORK must be mainnet or testnet');
  return network;
}

/**
 * Host only (`host:port`), TLS always. Accepts the `https://` form from .env.example so one
 * variable serves both docs and code.
 */
export function tatumGrpcHost(env: Env = process.env, network: PaymentNetwork = 'mainnet'): string {
  const raw = env['TATUM_SUI_GRPC_URL']?.trim();
  if (!raw) return TATUM_SUI_GRPC_HOSTS[network];
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (url.protocol !== 'https:') throw new TypeError('TATUM_SUI_GRPC_URL must use https');
  return `${url.hostname}:${url.port || '443'}`;
}

/**
 * Tatum speaks native gRPC over HTTP/2, not gRPC-Web, so the SDK's default fetch transport
 * fails against it (RESEARCH 2.1). This uses grpc-js and therefore runs on the Node runtime only.
 * The key travels as `x-api-key` call metadata and is never logged or echoed.
 */
export function createTatumGrpcClient(options: { apiKey: string | null; host?: string; network?: PaymentNetwork }): SuiGrpcClient {
  const network = options.network ?? 'mainnet';
  const transport = new GrpcTransport({
    host: options.host ?? TATUM_SUI_GRPC_HOSTS[network],
    channelCredentials: ChannelCredentials.createSsl(),
    // Without a key Tatum serves the anonymous plan: a few requests per second, enough for setup.
    meta: options.apiKey ? { 'x-api-key': options.apiKey } : {},
    timeout: 10_000,
  });
  return new SuiGrpcClient({ network, transport });
}
