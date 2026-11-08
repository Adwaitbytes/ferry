import type { ClientWithCoreApi } from '@mysten/sui/client';
import { describe, expect, it } from 'vitest';
import { coreClientTransactionFetcher } from '../src/core-client.js';
import { DIGEST, PAYER, RECIPIENT, USDC } from './fixtures.js';

function client(getTransaction: () => Promise<unknown>): ClientWithCoreApi {
  return { core: { getTransaction } } as unknown as ClientWithCoreApi;
}

describe('coreClientTransactionFetcher', () => {
  it('normalizes success and failure results', async () => {
    const base = { digest: DIGEST, checkpoint: '12', timestampMs: 5, transaction: { sender: PAYER }, balanceChanges: [{ address: RECIPIENT, coinType: USDC, amount: '10000' }] };
    const ok = await coreClientTransactionFetcher(client(async () => ({ Transaction: { ...base, status: { success: true } } })))(DIGEST);
    expect(ok).toEqual({ digest: DIGEST, status: 'success', sender: PAYER, checkpoint: 12n, timestampMs: 5, balanceChanges: [{ owner: RECIPIENT, coinType: USDC, amount: 10_000n }] });
    const failed = await coreClientTransactionFetcher(
      client(async () => ({ FailedTransaction: { ...base, checkpoint: null, transaction: {}, status: { success: false } } })),
    )(DIGEST);
    expect(failed).toMatchObject({ status: 'failure', checkpoint: null, sender: '' });
  });

  it('maps lookup errors to null', async () => {
    expect(await coreClientTransactionFetcher(client(async () => Promise.reject(new Error('404'))))(DIGEST)).toBeNull();
  });
});
