'use client';

import type { ImportProgress, Vendor } from '@ferry/core';
import { Button, cn, Counter, MonoId, Progress, SourceBadge, StatusPill, VENDOR_LABEL } from '@ferry/ui';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { spring } from '@ferry/ui/motion';
import { RotateCw } from 'lucide-react';
import Link from 'next/link';
import { FACT_TYPE_LABEL } from '@/lib/format';
import { explorer } from '@/lib/links';
import type { ReviewFact } from './pipeline';

const MAX_TRAVELLING = 8;
const MANIFEST_ROWS = 10;

function secondsUntil(iso: string | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

/**
 * Facts board the ferry only when the extension reports them written (DESIGN 5.3 A). The queue is
 * first in, first out, so the first `written` facts are the ones on Walrus.
 */
export function WritingStep({
  facts,
  texts,
  progress,
  onRetry,
  retrying,
}: {
  facts: readonly ReviewFact[];
  texts: Record<string, string>;
  progress: ImportProgress | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const reduce = useReducedMotion();
  const total = progress?.total || facts.length;
  const written = Math.min(progress?.written ?? 0, facts.length);
  const failed = progress?.failed ?? 0;
  const cooling = progress?.state === 'cooling_down';
  const resumeIn = secondsUntil(progress?.resumeAt);
  const boarded = facts.slice(0, written);
  const waiting = facts.slice(written, written + MAX_TRAVELLING);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-small font-medium text-text-secondary">
          <span>Your device</span>
          <span>Walrus Mainnet</span>
        </div>
        <Progress
          label="Moving facts to Walrus"
          value={written}
          max={total}
          tone={cooling ? 'warning' : 'accent'}
          valueText={<Counter value={written} format={(n) => `${Math.round(n).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`} />}
          ariaValueText={`${written} of ${total} facts moved`}
          helper={
            cooling
              ? `Cooling down to respect Walrus limits.${resumeIn !== null ? ` Resuming in ${resumeIn}s.` : ''}`
              : 'You can close this tab. The extension keeps writing, and Ferry resumes where it stopped.'
          }
        />
        <p aria-live="polite" className="sr-only">
          {`${written} of ${total} moved to Walrus`}
        </p>
        {failed > 0 ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-body text-danger">
            {`${failed} ${failed === 1 ? 'fact did' : 'facts did'} not save. Walrus Memory returned an error for them.`}
            <Button size="sm" icon={RotateCw} loading={retrying} loadingLabel="Retrying" onClick={onRetry}>
              {`Retry ${failed}`}
            </Button>
          </div>
        ) : null}
      </div>

      <LayoutGroup>
        <div className="grid gap-6 md:grid-cols-[1fr_240px]">
          <ul aria-label="Waiting to move" className="flex flex-col gap-3">
            {waiting.map((f) => (
              <motion.li
                key={f.fact.id}
                {...(reduce ? {} : { layoutId: f.fact.id })}
                transition={reduce ? { duration: 0 } : spring.board}
                exit={{ opacity: 0 }}
                className="rounded-md border border-border-hairline bg-surface-1 p-4 shadow-1"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-small font-medium text-text-secondary">{FACT_TYPE_LABEL[f.fact.type]}</span>
                  <span className="text-micro text-text-tertiary">Waiting</span>
                </div>
                <p className="text-body text-text-primary">{texts[f.fact.id] ?? f.fact.text}</p>
              </motion.li>
            ))}
            {facts.length - written - waiting.length > 0 ? (
              <li className="text-small text-text-tertiary">{`${(facts.length - written - waiting.length).toLocaleString('en-US')} more waiting`}</li>
            ) : null}
          </ul>

          <section aria-label="Manifest: on Walrus" className="flex flex-col gap-2 border-t border-border-strong pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
            <h3 className="text-small font-medium text-text-secondary">
              On Walrus <span className="tabular text-text-primary">{written.toLocaleString('en-US')}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {boarded.slice(-MANIFEST_ROWS).reverse().map((f) => (
                <motion.li
                  key={f.fact.id}
                  {...(reduce ? {} : { layoutId: f.fact.id })}
                  initial={reduce ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={reduce ? { duration: 0.15 } : spring.board}
                  className="flex h-8 items-center gap-2 rounded-sm bg-surface-1 px-2"
                >
                  <StatusPill status="active" className="shrink-0" />
                  <span className="truncate text-small text-text-primary">{texts[f.fact.id] ?? f.fact.text}</span>
                </motion.li>
              ))}
            </ul>
          </section>
        </div>
      </LayoutGroup>
    </div>
  );
}

/** The hero metric (DESIGN 8.3): three lines, numbers as tabular Counters inside display type. */
export function HeroMetric({
  vendor,
  found,
  owned,
  perSource,
  accountId,
  onAnother,
}: {
  vendor: Vendor;
  found: number;
  owned: number;
  perSource: [Vendor, number][];
  accountId: string | null;
  onAnother: () => void;
}) {
  const name = vendor === 'paste' ? 'Your assistant' : VENDOR_LABEL[vendor];
  const num = 'font-sans font-semibold tabular tracking-[-0.03em]';
  return (
    <section aria-labelledby="hero-metric" className="flex min-h-[60dvh] flex-col justify-center gap-10 py-8">
      <h2 id="hero-metric" className="ferry-display text-display-xl text-text-primary">
        <span className="block">
          {name} knew <Counter value={found} className={num} /> things about you.
        </span>
        <span className="block text-text-secondary">
          You owned <span className={num}>0</span>.
        </span>
        <span className="block">
          Now you own <Counter value={owned} className={cn(num, 'text-accent')} />.
        </span>
      </h2>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-wrap gap-4">
          {perSource.map(([v, n]) => (
            <li key={v} className="flex items-center gap-2">
              <SourceBadge vendor={v} />
              <Counter value={n} unit="facts" className="text-body font-medium text-text-primary" />
            </li>
          ))}
        </ul>
        {accountId ? (
          <p className="flex flex-wrap items-center gap-2 text-body text-text-secondary">
            Stored on Walrus Mainnet. Account
            <MonoId value={accountId} kind="Account object id" href={explorer.object(accountId)} />
            <Link href="/proofs" className="text-accent underline-offset-[3px] hover:underline">
              See the proof
            </Link>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/library" className="inline-flex h-11 items-center rounded-sm bg-accent px-[18px] text-body-lg font-medium text-accent-fg hover:bg-accent-hover">
          Open Library
        </Link>
        <Button size="lg" onClick={onAnother}>
          Rescue another source
        </Button>
      </div>
    </section>
  );
}
