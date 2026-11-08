import { CardId, GateRecallQuery, GateRecallResult as GateRecallResultSchema } from '@ferry/core';
import { PaymentRefusedError, payingFetch } from '@ferry/pay/client';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { FerryError } from './errors.js';
import type { ExecutePayment, GateRecallResult } from './types.js';

export type { ExecutePayment, GateRecallResult };

/** 0.01 USDC. X-SDK-1: the SDK never pays more than this unless the caller raises it. */
export const DEFAULT_MAX_PRICE_MICROS = 10_000n;
const MAINNET_FULLNODE = 'https://fullnode.mainnet.sui.io:443';

export interface FerryOptions {
  /** Gate base URL. HTTPS required, except localhost for development. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Sui client used to submit the payment. Defaults to the public Mainnet fullnode. */
  suiClient?: ClientWithCoreApi;
  /** Replaces payment submission, for example to route through a sponsored gas station. */
  execute?: ExecutePayment;
}

export interface RecallOptions {
  /** The agent's Sui signer (for example an Ed25519Keypair). Never logged or serialized. */
  payer: Signer;
  /** Highest price this call may pay, in micro-USDC. Defaults to 10000 (0.01 USDC). */
  maxPriceMicros?: bigint;
  signal?: AbortSignal;
}

export const CardInfo = z.object({
  id: CardId,
  name: z.string(),
  scopeLabel: z.string(),
  priceMicros: z.string().regex(/^\d+$/),
  price: z.string(),
  currency: z.string(),
  recipient: z.string(),
});
export type CardInfo = z.infer<typeof CardInfo>;

const ErrorBody = z.object({ error: z.string() });

function assertBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FerryError('INVALID_BASE_URL', 'baseUrl is not a URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new FerryError('INSECURE_BASE_URL', 'baseUrl must use https');
  }
  return url;
}

async function failure(response: Response): Promise<FerryError> {
  let code = `http_${response.status}`;
  try {
    const parsed = ErrorBody.safeParse(await response.json());
    if (parsed.success) code = parsed.data.error;
  } catch {
    // Non-JSON error bodies keep the status-derived code.
  }
  return new FerryError(code.toUpperCase(), `Gate answered ${response.status} (${code})`, response.status);
}

export interface FerryCard {
  readonly id: string;
  info(): Promise<CardInfo>;
  recall(q: string, options: RecallOptions): Promise<GateRecallResult>;
}

export interface Ferry {
  card(id: string): FerryCard;
}

export function createFerry(options: FerryOptions): Ferry {
  const base = assertBaseUrl(options.baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let suiClient = options.suiClient;
  const client = (): ClientWithCoreApi => (suiClient ??= new SuiGrpcClient({ network: 'mainnet', baseUrl: MAINNET_FULLNODE }));

  return {
    card(id) {
      if (!CardId.safeParse(id).success) throw new FerryError('INVALID_CARD_ID', 'card id must be 22 base64url characters');
      const cardUrl = new URL(`v1/cards/${id}`, base.href.endsWith('/') ? base : new URL(`${base.href}/`));
      return {
        id,
        async info() {
          const response = await doFetch(cardUrl.href, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw await failure(response);
          return CardInfo.parse(await response.json());
        },
        async recall(q, recallOptions) {
          const query = GateRecallQuery.safeParse({ q });
          if (!query.success) throw new FerryError('INVALID_QUERY', 'q must be 1 to 300 characters');
          // POST keeps the query out of URL access logs (X-GATE-2).
          const init: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(query.data),
            ...(recallOptions.signal ? { signal: recallOptions.signal } : {}),
          };
          let paid;
          try {
            paid = await payingFetch(`${cardUrl.href}/recall`, init, {
              signer: recallOptions.payer,
              suiClient: client(),
              maxPriceMicros: recallOptions.maxPriceMicros ?? DEFAULT_MAX_PRICE_MICROS,
              fetch: doFetch,
              ...(options.execute ? { execute: options.execute } : {}),
            });
          } catch (error) {
            if (error instanceof PaymentRefusedError) throw new FerryError(error.reason, error.message);
            throw error;
          }
          if (!paid.response.ok) throw await failure(paid.response);
          const result = GateRecallResultSchema.safeParse(await paid.response.json());
          if (!result.success) throw new FerryError('INVALID_RESPONSE', 'Gate response does not match GateRecallResult');
          if (result.data.cardId !== id) throw new FerryError('INVALID_RESPONSE', 'Gate answered for a different card');
          if (normalizeSuiAddress(result.data.payment.payer) !== normalizeSuiAddress(recallOptions.payer.toSuiAddress())) {
            throw new FerryError('INVALID_RESPONSE', 'Gate receipt names a different payer');
          }
          return result.data;
        },
      };
    },
  };
}

function envGateUrl(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.['FERRY_GATE_URL'];
}

/** Ready-made client. Reads FERRY_GATE_URL when it exists, else a local Gate (`vercel dev`). */
export const ferry: Ferry = {
  card: (id) => createFerry({ baseUrl: envGateUrl() ?? 'http://localhost:3001' }).card(id),
};
