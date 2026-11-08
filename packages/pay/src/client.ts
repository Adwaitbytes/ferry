import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { USDC, sui, type SuiChargeOptions } from '@suimpp/mpp/client';
import { Challenge } from 'mppx';
import { Mppx } from 'mppx/client';
import { decimalToMicros } from './amount.js';
import { MAINNET_USDC_TYPE } from './constants.js';
import { tryNormalizeAddress } from './normalize.js';

/** Codes after which re-sending the same credential (not paying again) can still succeed. */
const RETRYABLE = new Set(['payment_pending', 'payment_not_found', 'payment_unverified']);

export class PaymentRefusedError extends Error {
  constructor(
    readonly reason: 'NOT_SUI_CHARGE' | 'WRONG_COIN' | 'PRICE_ABOVE_MAX' | 'BAD_RECIPIENT' | 'BAD_CHALLENGE',
    message: string,
  ) {
    super(message);
    this.name = 'PaymentRefusedError';
  }
}

export interface PayingFetchOptions {
  signer: Signer;
  suiClient: ClientWithCoreApi;
  /** X-SDK-1: refuse any challenge above this. Required so a hostile server cannot name its price. */
  maxPriceMicros: bigint;
  fetch?: typeof globalThis.fetch;
  /** Overrides transaction submission, for example to route through a gas station. */
  execute?: SuiChargeOptions['execute'];
  /** How many times to re-present the same credential while the Gate reports the payment pending. */
  pendingRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PaidResponse {
  response: Response;
  /** True when this call submitted a payment transaction. */
  paid: boolean;
}

/** Validates a 402 before any money moves: Sui charge, Mainnet USDC, price under the cap. */
export function assertAcceptableChallenge(challenge: Challenge.Challenge, maxPriceMicros: bigint): bigint {
  if (challenge.method !== 'sui' || challenge.intent !== 'charge') throw new PaymentRefusedError('NOT_SUI_CHARGE', 'challenge is not a Sui charge');
  const { amount, currency, recipient } = challenge.request;
  if (currency !== MAINNET_USDC_TYPE) throw new PaymentRefusedError('WRONG_COIN', 'challenge currency is not Mainnet USDC');
  if (typeof recipient !== 'string' || tryNormalizeAddress(recipient) === null) {
    throw new PaymentRefusedError('BAD_RECIPIENT', 'challenge recipient is not a Sui address');
  }
  let micros: bigint;
  try {
    micros = decimalToMicros(typeof amount === 'string' ? amount : '');
  } catch {
    throw new PaymentRefusedError('BAD_CHALLENGE', 'challenge amount is not a USDC decimal');
  }
  if (micros <= 0n || micros > maxPriceMicros) throw new PaymentRefusedError('PRICE_ABOVE_MAX', `challenge asks ${micros} micro-USDC, cap is ${maxPriceMicros}`);
  return micros;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * Fetch that answers one MPP 402 by paying in Sui USDC. Pays at most once per call: retries
 * after payment re-send the same credential, never a new transaction (THREAT_MODEL 12).
 */
export async function payingFetch(url: string, init: RequestInit, options: PayingFetchOptions): Promise<PaidResponse> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const first = await doFetch(url, init);
  if (first.status !== 402) return { response: first, paid: false };

  let challenge: Challenge.Challenge;
  try {
    challenge = Challenge.fromResponse(first);
  } catch {
    throw new PaymentRefusedError('BAD_CHALLENGE', '402 without a Payment challenge');
  }
  assertAcceptableChallenge(challenge, options.maxPriceMicros);

  // polyfill: false, or mppx replaces globalThis.fetch for the whole process.
  const mppx = Mppx.create({
    methods: [
      sui({
        client: options.suiClient,
        signer: options.signer,
        currency: USDC,
        ...(options.execute ? { execute: options.execute } : {}),
      }),
    ],
    polyfill: false,
    fetch: doFetch,
  });
  const credential = await mppx.createCredential(first);

  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers = new Headers(init.headers);
  headers.set('Authorization', credential);
  const retries = options.pendingRetries ?? 4;
  let response = await doFetch(url, { ...init, headers });
  for (let attempt = 1; attempt <= retries && response.status === 402; attempt++) {
    const code = await errorCode(response);
    if (code === null || !RETRYABLE.has(code)) break;
    await sleep((options.retryDelayMs ?? 1500) * attempt);
    response = await doFetch(url, { ...init, headers });
  }
  return { response, paid: true };
}
