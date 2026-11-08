import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { NormalizedTransaction } from './verifier.js';

/**
 * Normalizes `client.core.getTransaction` into the verifier's shape. Works with any Sui core
 * client, including a SuiGrpcClient on Tatum's native gRPC transport. A lookup error is
 * reported as "not found", which the finality retry treats as worth asking again.
 */
export function coreClientTransactionFetcher(client: ClientWithCoreApi): (digest: string) => Promise<NormalizedTransaction | null> {
  return async (digest) => {
    let result;
    try {
      result = await client.core.getTransaction({ digest, include: { balanceChanges: true, transaction: true } });
    } catch {
      return null;
    }
    const tx = result.Transaction ?? result.FailedTransaction;
    return {
      digest: tx.digest,
      status: tx.status.success ? 'success' : 'failure',
      sender: tx.transaction.sender ?? '',
      checkpoint: tx.checkpoint === null ? null : BigInt(tx.checkpoint),
      timestampMs: tx.timestampMs,
      balanceChanges: tx.balanceChanges.map((change) => ({ owner: change.address, coinType: change.coinType, amount: BigInt(change.amount) })),
    };
  };
}
