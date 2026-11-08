'use client';

import type { Vendor } from '@ferry/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, CircleAlert, History, RotateCw, ShieldCheck, X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { duration, instant, spring } from '../motion';
import { SourceBadges, VENDOR_LABEL } from './badge';
import { Button, IconButton } from './button';
import { Counter } from './counter';
import { Perforation, Skeleton, SkeletonGroup } from './feedback';
import { MonoId } from './mono-id';
import { VerifyCheck } from './verify';

export type ChainState =
  | { status: 'loading' }
  | { status: 'unsaved'; message: string }
  | { status: 'error'; message: string; onRetry: () => void }
  | {
      status: 'ready';
      blobId: string;
      blobHref?: string | undefined;
      owner: string | null;
      ownerHref?: string | undefined;
      certifiedEpoch: number | null;
      endEpoch: number | null;
      /** For example "about 14 Mar 2027". */
      endLabel?: string | undefined;
      readThrough: string;
      latencyMs?: number | undefined;
    };

export type VerifyState =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'verified'; at: string }
  | { status: 'mismatch' }
  | { status: 'error'; message: string };

export interface ReceiptDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: string;
  sources: readonly Vendor[];
  /** For example "12 Oct 2026, 21:14". */
  saidAt: string;
  conversationUrl?: string | undefined;
  chain: ChainState;
  verify: VerifyState;
  onVerify: () => void;
  onHistory?: (() => void) | undefined;
  extra?: ReactNode | undefined;
}

/** The ticket stub (DESIGN 7.8): quote above the perforation, Sui and Walrus facts below it. */
export function ReceiptDrawer({
  open,
  onOpenChange,
  quote,
  sources,
  saidAt,
  conversationUrl,
  chain,
  verify,
  onVerify,
  onHistory,
  extra,
}: ReceiptDrawerProps) {
  const reduce = useReducedMotion();
  const primary = sources[0];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-30 bg-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: duration.slow } }}
                exit={{ opacity: 0, transition: { duration: duration.fast } }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount>
              <motion.aside
                initial={reduce ? { opacity: 0 } : { x: '100%' }}
                animate={reduce ? { opacity: 1 } : { x: 0 }}
                exit={reduce ? { opacity: 0 } : { x: '100%' }}
                transition={reduce ? instant : spring.drawer}
                className="fixed inset-y-0 right-0 z-30 flex w-full flex-col overflow-y-auto border-l border-border-strong bg-surface-2 shadow-3 sm:w-[440px]"
              >
                <div className="flex items-center justify-between px-6 pb-2 pt-5">
                  <RadixDialog.Title className="text-title font-semibold text-text-primary">Receipt</RadixDialog.Title>
                  <RadixDialog.Close asChild>
                    <IconButton icon={X} label="Close receipt" size="sm" />
                  </RadixDialog.Close>
                </div>
                <RadixDialog.Description className="sr-only">
                  Where this fact came from, and where it is stored on Walrus Mainnet.
                </RadixDialog.Description>

                <div className="px-6 pt-4">
                  <blockquote className="border-l-2 border-accent pl-4 text-body-lg text-text-primary [overflow-wrap:anywhere]">
                    {`“${quote}”`}
                  </blockquote>
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <SourceBadges vendors={sources} />
                    <span className="text-small text-text-tertiary">Said on {saidAt}</span>
                  </div>
                  <p className="mt-2 text-small">
                    {conversationUrl && primary ? (
                      <a
                        href={conversationUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-accent underline-offset-[3px] hover:underline"
                      >
                        Open conversation in {VENDOR_LABEL[primary]}
                        <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-text-tertiary">This vendor does not support links to a conversation.</span>
                    )}
                  </p>
                </div>

                <Perforation />

                <div className="px-6">
                  <ChainBlock chain={chain} />
                </div>

                <div className="mt-6 flex flex-col gap-3 px-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      icon={ShieldCheck}
                      onClick={onVerify}
                      loading={verify.status === 'verifying'}
                      loadingLabel="Verifying"
                      disabled={chain.status !== 'ready'}
                    >
                      {verify.status === 'verified' ? 'Verified' : 'Verify on Walrus'}
                    </Button>
                    <VerifyCheck state={verify.status === 'verified' ? 'verified' : 'idle'} size={24} />
                  </div>
                  <p aria-live="polite" className="text-small">
                    {verify.status === 'verified' ? (
                      <span className="text-success">Verified. Blob matches its id on Walrus. Checked at {verify.at}.</span>
                    ) : verify.status === 'mismatch' ? (
                      <span className="inline-flex items-start gap-1.5 text-danger">
                        <CircleAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                        Does not match. The blob returned by the aggregator differs from this id.
                      </span>
                    ) : verify.status === 'error' ? (
                      <span className="text-danger">{verify.message}</span>
                    ) : null}
                  </p>
                </div>

                {extra ? <div className="px-6 pt-4">{extra}</div> : null}

                {onHistory ? (
                  <div className="mt-auto border-t border-border-hairline px-6 py-4">
                    <Button variant="ghost" size="sm" icon={History} onClick={onHistory} className="-ml-2.5">
                      See how this fact changed
                    </Button>
                  </div>
                ) : null}
              </motion.aside>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

function ChainBlock({ chain }: { chain: ChainState }) {
  if (chain.status === 'loading') {
    return (
      <SkeletonGroup label="Reading Sui through Tatum" className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[140px_1fr] gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
        <p className="text-small text-text-tertiary">Reading Sui through Tatum</p>
      </SkeletonGroup>
    );
  }
  if (chain.status === 'unsaved') {
    return <p className="text-small text-text-secondary">{chain.message}</p>;
  }
  if (chain.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          {chain.message}
        </p>
        <Button size="sm" icon={RotateCw} onClick={chain.onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-3 text-small">
      <dt className="text-text-secondary">Walrus blob</dt>
      <dd className="min-w-0">
        <MonoId value={chain.blobId} kind="Blob id" href={chain.blobHref} hrefLabel="Open blob in Walrus explorer" />
      </dd>
      <dt className="text-text-secondary">Owner</dt>
      <dd className="min-w-0">
        {chain.owner ? <MonoId value={chain.owner} kind="Sui address" href={chain.ownerHref} /> : <span className="text-text-tertiary">Not reported</span>}
      </dd>
      <dt className="text-text-secondary">Certified at epoch</dt>
      <dd>{chain.certifiedEpoch !== null ? <Counter value={chain.certifiedEpoch} /> : <span className="text-text-tertiary">Not certified yet</span>}</dd>
      <dt className="text-text-secondary">Stored until epoch</dt>
      <dd>
        {chain.endEpoch !== null ? (
          <>
            <Counter value={chain.endEpoch} />
            {chain.endLabel ? <span className="text-text-tertiary"> {chain.endLabel}</span> : null}
          </>
        ) : (
          <span className="text-text-tertiary">Not reported</span>
        )}
      </dd>
      <dt className="text-text-secondary">Read through</dt>
      <dd className="text-text-primary">
        {chain.readThrough}
        {chain.latencyMs !== undefined ? <span className="tabular text-text-tertiary">, {chain.latencyMs} ms</span> : null}
      </dd>
    </dl>
  );
}
