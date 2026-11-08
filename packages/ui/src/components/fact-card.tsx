'use client';

import type { Vendor } from '@ferry/core';
import { motion, useReducedMotion } from 'motion/react';
import { Receipt, ShieldQuestion } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { duration, instant, spring } from '../motion';
import { StatusPill, SourceBadges, type PillStatus } from './badge';
import { Button, IconButton } from './button';
import { Textarea } from './field';
import { Toggle } from './toggle';

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return 'High confidence';
  if (confidence >= 0.6) return 'Medium confidence';
  return 'Low confidence';
}

export interface FactCardProps {
  typeLabel: string;
  text: string;
  status: PillStatus;
  sources: readonly Vendor[];
  /** Already formatted, for example "12 Oct 2026". */
  date: string;
  confidence?: number | undefined;
  onOpenReceipt?: (() => void) | undefined;
  /** Action buttons row (approve, edit, discard in review; menu in Library). */
  actions?: ReactNode | undefined;
  selected?: boolean | undefined;
  /** Sensitive facts are off by default and need an explicit include (DESIGN 7.7). */
  sensitive?: { label: string; included: boolean; onIncludedChange: (included: boolean) => void } | undefined;
  /** When set, the fact text becomes an editable textarea. */
  editing?: { maxLength: number; onSave: (text: string) => void; onCancel: () => void } | undefined;
  className?: string | undefined;
}

/** One fact with its receipt line under the waterline (DESIGN 7.7). Animates with spring.card. */
export function FactCard({
  typeLabel,
  text,
  status,
  sources,
  date,
  confidence,
  onOpenReceipt,
  actions,
  selected,
  sensitive,
  editing,
  className,
}: FactCardProps) {
  const titleId = useId();
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState(text);
  const [expanded, setExpanded] = useState(false);
  const isQuarantine = status === 'quarantine';
  const long = text.length > 220;

  return (
    <motion.article
      layout={!reduce}
      aria-labelledby={titleId}
      initial={false}
      exit={reduce ? { opacity: 0, transition: { duration: duration.fast } } : { opacity: 0, x: -12, transition: spring.card }}
      transition={reduce ? instant : spring.card}
      className={cn(
        'group relative flex flex-col rounded-md border bg-surface-1 p-5 shadow-1 transition-[border-color,box-shadow] duration-150 ease-out',
        selected ? 'border-accent' : 'border-border-hairline hover:border-border-strong hover:shadow-2',
        status === 'conflict' && 'border-l-2 border-l-warning',
        className,
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <span className="text-small font-medium text-text-secondary">{typeLabel}</span>
        <StatusPill status={status} />
      </header>

      {editing ? (
        <div className="flex flex-col gap-3">
          <Textarea
            label="Edit fact"
            hideLabel
            value={draft}
            maxLength={editing.maxLength}
            showCount
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={draft.trim().length === 0} onClick={() => editing.onSave(draft.trim())}>
              Save edit
            </Button>
            <Button size="sm" variant="ghost" onClick={editing.onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : isQuarantine ? (
        <div className="flex flex-col gap-2">
          <p id={titleId} className="rounded-sm bg-surface-3 px-3 py-2 font-mono text-[0.8125rem] text-text-primary [overflow-wrap:anywhere]">
            {text}
          </p>
          <p className="text-small text-danger">Not saved. Flagged as possible instructions.</p>
        </div>
      ) : (
        <div>
          <p
            id={titleId}
            className={cn(
              'text-[0.9375rem] leading-6 [overflow-wrap:anywhere]',
              status === 'superseded' && 'text-text-secondary',
              status === 'hidden' && 'text-text-tertiary line-through',
              status !== 'superseded' && status !== 'hidden' && 'text-text-primary',
              long && !expanded && 'line-clamp-3',
            )}
          >
            {text}
          </p>
          {long ? (
            <Button variant="link" size="sm" className="mt-1 text-small" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Show all'}
            </Button>
          ) : null}
        </div>
      )}

      {sensitive ? (
        <div className="mt-3 flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2">
          <ShieldQuestion size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text-secondary" />
          <Toggle
            className="flex-1"
            label={sensitive.label}
            checked={sensitive.included}
            onCheckedChange={sensitive.onIncludedChange}
            showState
          />
        </div>
      ) : null}

      <hr aria-hidden="true" className="my-4 border-0 border-t border-border-hairline" />

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SourceBadges vendors={sources} />
        <span className="text-small text-text-tertiary">{date}</span>
        {confidence !== undefined ? <span className="text-small text-text-tertiary">{confidenceLabel(confidence)}</span> : null}
        <span className="ml-auto flex items-center gap-1">
          {actions}
          {onOpenReceipt ? <IconButton icon={Receipt} label="Open receipt" size="sm" onClick={onOpenReceipt} /> : null}
        </span>
      </footer>
    </motion.article>
  );
}
