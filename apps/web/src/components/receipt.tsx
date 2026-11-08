'use client';

import type { Receipt, Vendor } from '@ferry/core';
import { ReceiptDrawer, type ChainState, type VerifyState } from '@ferry/ui';
import { useCallback, useEffect, useState } from 'react';
import { getBlob } from '@/lib/api';
import { publicEnv } from '@/lib/env';
import { aboutEpochDate, formatDateTime, formatTime } from '@/lib/format';
import { explorer } from '@/lib/links';

export interface ReceiptTarget {
  /** The quote shown on the stub. Falls back to the fact text when the receipt has no quote. */
  quote: string;
  sources: readonly Vendor[];
  receipt: Receipt | null;
  /** Walrus blob id, when the fact is stored. Unsaved facts (Rescue review) have none. */
  blobId: string | null;
}

/**
 * Verify refetches the blob from a public Walrus aggregator. Aggregators rebuild a blob from
 * slivers that are checked against the blob id, so a 200 for this id plus a Sui object that carries
 * the same id is the match the stamp reports.
 */
async function verifyOnWalrus(blobId: string): Promise<'verified' | 'mismatch'> {
  const response = await fetch(`${publicEnv.aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`, { cache: 'no-store' });
  if (response.status === 404) return 'mismatch';
  if (!response.ok) throw new Error(`The Walrus aggregator returned ${response.status}. Try again.`);
  await response.arrayBuffer();
  const { blob } = await getBlob(blobId);
  return blob.blobId === blobId ? 'verified' : 'mismatch';
}

export function ReceiptView({ target, onClose, onHistory }: { target: ReceiptTarget | null; onClose: () => void; onHistory?: () => void }) {
  const [chain, setChain] = useState<ChainState>({ status: 'loading' });
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const blobId = target?.blobId ?? null;

  useEffect(() => {
    setVerify({ status: 'idle' });
    if (!blobId) return;
    let active = true;
    setChain({ status: 'loading' });
    getBlob(blobId).then(
      ({ blob, latencyMs }) => {
        if (!active) return;
        setChain({
          status: 'ready',
          blobId: blob.blobId,
          blobHref: explorer.blob(blob.blobId),
          owner: blob.owner,
          ownerHref: blob.owner ? explorer.account(blob.owner) : undefined,
          certifiedEpoch: blob.certifiedEpoch,
          endEpoch: blob.endEpoch,
          endLabel: blob.endEpoch !== null ? aboutEpochDate(blob.endEpoch, blob.currentEpoch) : undefined,
          readThrough: 'Tatum Sui gRPC',
          latencyMs,
        });
      },
      (error: unknown) => {
        if (!active) return;
        const reason = error instanceof Error ? error.message : 'Tatum did not answer.';
        setChain({ status: 'error', message: `Could not read this blob from Sui. ${reason}`, onRetry: () => setAttempt((n) => n + 1) });
      },
    );
    return () => {
      active = false;
    };
  }, [blobId, attempt]);

  const onVerify = useCallback(() => {
    if (!blobId) return;
    setVerify({ status: 'verifying' });
    verifyOnWalrus(blobId).then(
      (result) => setVerify(result === 'verified' ? { status: 'verified', at: formatTime(Date.now()) } : { status: 'mismatch' }),
      (error: unknown) => setVerify({ status: 'error', message: error instanceof Error ? error.message : 'Verification failed. Try again.' }),
    );
  }, [blobId]);

  const receipt = target?.receipt ?? null;
  return (
    <ReceiptDrawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      quote={receipt?.quote || target?.quote || ''}
      sources={target?.sources ?? []}
      saidAt={receipt ? formatDateTime(receipt.messageAt) : 'an unknown time'}
      conversationUrl={receipt?.conversationUrl}
      chain={blobId ? chain : { status: 'unsaved', message: 'Not on Walrus yet. This fact gets a blob when you move it.' }}
      verify={verify}
      onVerify={onVerify}
      onHistory={onHistory}
    />
  );
}
