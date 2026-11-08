import type { ChainService } from '@ferry/chain';
import { withFinalityRetry, type PaymentVerifier } from '@ferry/pay';

/**
 * Adapts `verifyUsdcPayment` from packages/chain (Tatum gRPC) to the pay verifier contract. A
 * thrown error (Tatum rate limit, upstream outage) is reported as NOT_FOUND: retryable, and it
 * never consumes the digest, so the agent can present the same proof again.
 */
export function chainVerifier(chain: Pick<ChainService, 'verifyUsdcPayment'>): PaymentVerifier {
  return {
    async verify(request) {
      try {
        const result = await chain.verifyUsdcPayment({
          digest: request.digest,
          recipient: request.recipient,
          coinType: request.coinType,
          minAmountMicros: request.minAmountMicros,
          notBeforeMs: request.notBeforeMs,
          notAfterMs: request.notAfterMs,
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        return { ok: true, sender: result.payer, amountMicros: result.amountMicros, checkpoint: result.checkpoint, timestampMs: result.timestampMs };
      } catch {
        return { ok: false, reason: 'NOT_FOUND' };
      }
    },
  };
}

/** Tatum's free plan is 3 rps, so finality polling is short and spaced. */
export function tatumVerifier(chain: Pick<ChainService, 'verifyUsdcPayment'>): PaymentVerifier {
  return withFinalityRetry(chainVerifier(chain), { attempts: 4, delayMs: 750 });
}
