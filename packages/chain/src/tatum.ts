import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SUI_NETWORK, TATUM_SUI_GRPC_HOST } from './constants.js';

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
 * Host only (`host:port`), TLS always. Accepts the `https://` form from .env.example so one
 * variable serves both docs and code.
 */
export function tatumGrpcHost(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env['TATUM_SUI_GRPC_URL']?.trim();
  if (!raw) return TATUM_SUI_GRPC_HOST;
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (url.protocol !== 'https:') throw new TypeError('TATUM_SUI_GRPC_URL must use https');
  return `${url.hostname}:${url.port || '443'}`;
}

/**
 * Tatum speaks native gRPC over HTTP/2, not gRPC-Web, so the SDK's default fetch transport
 * fails against it (RESEARCH 2.1). This uses grpc-js and therefore runs on the Node runtime only.
 * The key travels as `x-api-key` call metadata and is never logged or echoed.
 */
export function createTatumGrpcClient(options: { apiKey: string; host?: string }): SuiGrpcClient {
  const transport = new GrpcTransport({
    host: options.host ?? TATUM_SUI_GRPC_HOST,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { 'x-api-key': options.apiKey },
    timeout: 10_000,
  });
  return new SuiGrpcClient({ network: SUI_NETWORK, transport });
}
