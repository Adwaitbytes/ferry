import type { Transaction } from '@mysten/sui/transactions';

/**
 * Public result type, written out so the published declarations do not reference private
 * workspace packages. Runtime validation still uses the frozen `GateRecallResult` schema from
 * @ferry/core, and a type test asserts the two stay identical.
 */
export interface GateRecallResult {
  cardId: string;
  results: {
    text: string;
    type: 'identity' | 'preference' | 'dislike' | 'person' | 'project' | 'goal' | 'routine' | 'decision' | 'skill' | 'constraint' | 'lesson';
    sources: ('chatgpt' | 'claude' | 'gemini' | 'paste' | 'desk' | 'manual')[];
    heardAt: string;
    memoryRef: string;
  }[];
  payment: { digest: string; amountMicros: string; receiptId: string; payer: string };
}

/** Replaces payment submission, for example to route through a sponsored gas station. */
export type ExecutePayment = (tx: Transaction) => Promise<{ digest: string }>;
