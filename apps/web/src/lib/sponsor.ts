import { createSponsorAuthorization } from '@ferry/chain/tx';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { z } from 'zod';
import type { dAppKit as DAppKitInstance } from './dapp-kit';

type Kit = typeof DAppKitInstance;

const Sponsored = z.object({ bytes: z.string().min(1), digest: z.string().min(1) });

export class SponsorUnavailableError extends Error {}

async function post(body: unknown): Promise<unknown> {
  const res = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new SponsorUnavailableError(json.error ?? `sponsor ${res.status}`);
  return json;
}

/**
 * Runs one MemWal account transaction with the Walrus Memory relayer paying gas. The wallet signs
 * a short authorization message, then the sponsored transaction itself. Returns the digest.
 */
export async function sponsoredExecute(kit: Kit, sender: string, tx: Transaction): Promise<string> {
  const kindBytes = await tx.build({ client: kit.getClient(), onlyTransactionKind: true });
  const auth = await createSponsorAuthorization(sender, kindBytes, async (message) => {
    const signed = await kit.signPersonalMessage({ message });
    return { signature: signed.signature };
  });
  const sponsored = Sponsored.parse(
    await post({ action: 'sponsor', sender, transactionBlockKindBytes: toBase64(kindBytes), ...auth }),
  );
  const signed = await kit.signTransaction({ transaction: Transaction.from(fromBase64(sponsored.bytes)) });
  await post({ action: 'execute', sender, digest: sponsored.digest, signature: signed.signature });
  return sponsored.digest;
}
