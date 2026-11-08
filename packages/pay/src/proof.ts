const encoder = new TextEncoder();

/** The subset of an mppx challenge that the suimpp payment proof signs over. */
export interface MppProofChallenge {
  id: string;
  method: string;
  intent: string;
  request: Record<string, unknown>;
}

/**
 * Byte-for-byte the message `@suimpp/mpp@0.9.0` signs (`createSuiPaymentProofMessage` in
 * dist/client.js and dist/server.js). It is not exported, so it is rebuilt here; the field order
 * matters because it is a JSON.stringify of an object literal. A test signs with the real
 * library client path and verifies with this function to catch drift on upgrade.
 */
export function mppProofMessage(challenge: MppProofChallenge, digest: string): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      domain: 'suimpp.sui.payment-proof',
      version: 1,
      method: challenge.method,
      intent: challenge.intent,
      challengeId: challenge.id,
      amount: challenge.request['amount'],
      currency: challenge.request['currency'],
      recipient: challenge.request['recipient'],
      digest,
    }),
  );
}

/** X-PAY-1: what a digest-only proof must be signed over by the transaction sender. */
export function digestBindingMessage(cardId: string, challengeId: string, digest: string): Uint8Array {
  return encoder.encode(`ferry-gate:v1:${cardId}:${challengeId}:${digest}`);
}
