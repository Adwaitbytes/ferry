import type { ClientWithCoreApi } from '@mysten/sui/client';
import { USDC, sui, type SuiServerOptions } from '@suimpp/mpp/server';
import {
  X402_PAYMENT_HEADER,
  X402_PAYMENT_RESPONSE_HEADER,
  createX402Requirements,
  encodeX402Response,
  parseX402Header,
  settleX402Payment,
  type X402PaymentPayload,
  type X402Requirements,
} from '@suimpp/mpp/x402';
import { Challenge, Credential } from 'mppx';
import { Mppx } from 'mppx/server';
import { z } from 'zod';
import { microsToDecimal } from './amount.js';
import { CHALLENGE_TTL_MS, MAINNET_USDC_TYPE } from './constants.js';
import { BoundDigestStore, refusalOf } from './digest-store.js';
import { payFailure, type PayFailure } from './errors.js';
import { normalizeAddress } from './normalize.js';
import type { Card, PayStore } from './store.js';
import type { PaymentVerifier } from './verifier.js';
import { checkPayment, commitPayment, type VerifiedPayment } from './verify-payment.js';

export type SuiServerMethod = ReturnType<typeof sui>;
export type SuiNetwork = 'mainnet' | 'testnet';

export interface GatePaymentsConfig {
  store: PayStore;
  /** Tatum-backed in production. Every payment is re-verified through it before serving. */
  verifier: PaymentVerifier;
  /** HMAC key binding mppx challenge ids to their contents. 32+ random bytes. */
  secretKey: string;
  /** Stable realm, so a challenge issued by one Vercel instance verifies on another. */
  realm: string;
  network?: SuiNetwork;
  /** Defaults to the real suimpp server method. Tests inject one that skips the fullnode. */
  createMethod?: (options: SuiServerOptions) => SuiServerMethod;
  /** Enables the x402 dialect. The client executes the payer-signed bytes and reads chain info. */
  x402Client?: ClientWithCoreApi;
  now?: () => number;
}

export interface PaymentRequiredResult {
  status: 402;
  challengeId: string;
  response: Response;
}

export type SettleResult =
  | (VerifiedPayment & { dialect: 'mpp' | 'x402'; attach: (response: Response) => Response })
  | (PayFailure & { headers?: Record<string, string> });

const MppPayload = z.object({ digest: z.string().min(1).max(128), signature: z.string().min(1).max(4096) });

/** Wire body of a 402: x402 `accepts` plus the MPP terms, so either kind of client can pay. */
export interface PaymentRequiredBody {
  error: 'payment_required';
  x402Version: 1;
  accepts: X402Requirements[];
  mpp: { challengeId: string; amountMicros: string; currency: string; recipient: string; expires: string };
}

const CHAIN_INFO_TTL_MS = 60_000;

/**
 * Gate payment engine. MPP (`Authorization: Payment`) is primary; x402 (`X-PAYMENT`) is the
 * fallback selected by header. Both end in the same Neon replay table and the same Tatum
 * re-verification, so neither dialect is a weaker path.
 */
export class GatePayments {
  private readonly network: SuiNetwork;
  private readonly createMethod: (options: SuiServerOptions) => SuiServerMethod;
  private readonly now: () => number;
  private chainInfo: { chain: string; epoch: string; fetchedAtMs: number } | null = null;

  constructor(private readonly config: GatePaymentsConfig) {
    this.network = config.network ?? 'mainnet';
    this.createMethod = config.createMethod ?? sui;
    this.now = config.now ?? Date.now;
  }

  /** Which dialect a request is paying with, or null if it carries no payment. */
  static dialectOf(request: Request): 'mpp' | 'x402' | null {
    if (request.headers.has(X402_PAYMENT_HEADER)) return 'x402';
    const authorization = request.headers.get('Authorization');
    return authorization !== null && Credential.extractPaymentScheme(authorization) !== null ? 'mpp' : null;
  }

  private mppx(card: Card, store: BoundDigestStore | null) {
    const method = this.createMethod({
      currency: USDC,
      recipient: normalizeAddress(card.ownerAddress),
      network: this.network,
      // Never consulted on the challenge path: only verify() touches the store.
      store: store ?? { has: async () => true, set: async () => undefined },
    });
    return Mppx.create({ methods: [method], secretKey: this.config.secretKey, realm: this.config.realm });
  }

  /** Issues a 402 with an MPP challenge and x402 requirements, and stores the binding (X-PAY-2). */
  async paymentRequired(card: Card, resource: string): Promise<PaymentRequiredResult> {
    const nowMs = this.now();
    const expires = new Date(nowMs + CHALLENGE_TTL_MS).toISOString();
    const amount = microsToDecimal(card.priceMicros);
    const recipient = normalizeAddress(card.ownerAddress);
    const handler = this.mppx(card, null).charge({ amount, expires, meta: { cardId: card.id } });
    const issued = await handler(new Request(resource));
    if (issued.status !== 402) throw new Error('mppx did not issue a challenge for a request without a credential');
    const challenge = Challenge.fromResponse(issued.challenge);
    await this.config.store.insertChallenge({
      id: challenge.id,
      cardId: card.id,
      priceMicros: card.priceMicros,
      recipient,
      issuedAtMs: nowMs,
      expiresAtMs: Date.parse(expires),
    });

    const accepts: X402Requirements[] = [];
    const info = await this.loadChainInfo(nowMs);
    if (info) {
      accepts.push(
        createX402Requirements({
          challengeId: challenge.id,
          amount,
          currency: USDC,
          recipient,
          resource,
          network: this.network,
          chain: info.chain,
          currentEpoch: info.epoch,
        }),
      );
    }
    const body: PaymentRequiredBody = {
      error: 'payment_required',
      x402Version: 1,
      accepts,
      mpp: { challengeId: challenge.id, amountMicros: card.priceMicros.toString(), currency: MAINNET_USDC_TYPE, recipient, expires },
    };
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const wwwAuthenticate = issued.challenge.headers.get('WWW-Authenticate');
    if (wwwAuthenticate) headers.set('WWW-Authenticate', wwwAuthenticate);
    return { status: 402, challengeId: challenge.id, response: new Response(JSON.stringify(body), { status: 402, headers }) };
  }

  /**
   * x402 needs the chain identifier and current epoch for `ValidDuring`. Cached briefly; if the
   * read fails the 402 still carries the MPP challenge, so the fallback degrades, not the Gate.
   */
  private async loadChainInfo(nowMs: number): Promise<{ chain: string; epoch: string } | null> {
    const client = this.config.x402Client;
    if (!client) return null;
    if (this.chainInfo && nowMs - this.chainInfo.fetchedAtMs < CHAIN_INFO_TTL_MS) return this.chainInfo;
    try {
      const [{ chainIdentifier }, { systemState }] = await Promise.all([client.core.getChainIdentifier(), client.core.getCurrentSystemState()]);
      this.chainInfo = { chain: chainIdentifier, epoch: systemState.epoch, fetchedAtMs: nowMs };
      return this.chainInfo;
    } catch {
      return null;
    }
  }

  /** Verifies the payment on a request and commits it. Recall may run only when `ok` is true. */
  async settle(request: Request, card: Card, querySha256: string): Promise<SettleResult> {
    const dialect = GatePayments.dialectOf(request);
    if (dialect === 'x402') return this.settleX402(request, card, querySha256);
    if (dialect === 'mpp') return this.settleMpp(request, card, querySha256);
    return payFailure('PAYMENT_INVALID');
  }

  private async settleMpp(request: Request, card: Card, querySha256: string): Promise<SettleResult> {
    let credential: Credential.Credential;
    try {
      credential = Credential.fromRequest(request);
    } catch {
      return payFailure('PAYMENT_INVALID');
    }
    if (!Challenge.verify(credential.challenge, { secretKey: this.config.secretKey })) return payFailure('CHALLENGE_MISMATCH');
    const payload = MppPayload.safeParse(credential.payload);
    if (!payload.success) return payFailure('PAYMENT_INVALID');

    const nowMs = this.now();
    const checked = await checkPayment(
      {
        challengeId: credential.challenge.id,
        proof: { kind: 'mpp', digest: payload.data.digest, signature: payload.data.signature, challenge: credential.challenge },
        card,
        querySha256,
        nowMs,
      },
      { store: this.config.store, verifier: this.config.verifier },
    );
    if (!checked.ok) return checked;

    // The suimpp verifier now repeats the chain checks against the fullnode and calls
    // store.set(digest) last, which is where the atomic insert happens.
    const store = new BoundDigestStore(this.config.store, () => commitPayment(checked, this.config.store, nowMs));
    const result = await this.mppx(card, store).charge({ amount: microsToDecimal(card.priceMicros) })(request);
    const outcome = store.outcome;
    // A refusal before set() is either a digest a racing request just committed or the
    // library's own chain check failing.
    if (result.status === 402 || !outcome?.ok) return refusalOf(store, this.config.store);
    return { ...outcome, dialect: 'mpp', attach: (response) => result.withReceipt(response) };
  }

  private async settleX402(request: Request, card: Card, querySha256: string): Promise<SettleResult> {
    const client = this.config.x402Client;
    if (!client) return payFailure('PAYMENT_INVALID');
    let payment: X402PaymentPayload;
    try {
      payment = parseX402Header(request.headers.get(X402_PAYMENT_HEADER) ?? '');
    } catch {
      return payFailure('PAYMENT_INVALID');
    }
    const nowMs = this.now();
    const challenge = await this.config.store.getChallenge(payment.payload.challengeId);
    if (!challenge || challenge.cardId !== card.id || challenge.priceMicros !== card.priceMicros) return payFailure('CHALLENGE_MISMATCH');
    if (nowMs > challenge.expiresAtMs) return payFailure('PAYMENT_EXPIRED');

    // set() runs after the library executed the signed bytes and checked balance changes. The
    // Tatum re-verification and the unique insert both happen inside it, before anything is served.
    const store = new BoundDigestStore(this.config.store, async (digest) => {
      const checked = await checkPayment(
        { challengeId: challenge.id, proof: { kind: 'settled', digest }, card, querySha256, nowMs },
        { store: this.config.store, verifier: this.config.verifier },
      );
      return checked.ok ? commitPayment(checked, this.config.store, nowMs) : checked;
    });
    try {
      const settled = await settleX402Payment({
        payment,
        client,
        store,
        expected: {
          challengeId: challenge.id,
          amount: microsToDecimal(challenge.priceMicros),
          currency: USDC,
          recipient: challenge.recipient,
          network: this.network,
        },
      });
      const outcome = store.outcome;
      if (!outcome?.ok) return refusalOf(store, this.config.store);
      const header = encodeX402Response(settled);
      return {
        ...outcome,
        dialect: 'x402',
        attach: (response) => {
          response.headers.set(X402_PAYMENT_RESPONSE_HEADER, header);
          return response;
        },
      };
    } catch {
      return refusalOf(store, this.config.store);
    }
  }
}
