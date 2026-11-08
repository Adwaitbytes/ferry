'use client';

import type { Vendor } from '@ferry/core';
import { Columns2, Merge, Replace, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../cn';
import { StatusPill, SourceBadges } from './badge';
import { Button } from './button';
import { Input, Textarea } from './field';

export interface ConflictSide {
  text: string;
  sources: readonly Vendor[];
  /** For example "Mar 2026". */
  date: string;
}

export type ConflictChoice =
  | { kind: 'keep_new' }
  | { kind: 'keep_old' }
  | { kind: 'merge'; text: string }
  | { kind: 'keep_both'; context: string };

export interface ConflictCardProps {
  older: ConflictSide;
  newer: ConflictSide;
  /** Prefill for the merge textarea. */
  mergeSuggestion: string;
  maxLength: number;
  onResolve: (choice: ConflictChoice) => void;
  resolving?: boolean | undefined;
  error?: string | null | undefined;
  className?: string | undefined;
}

type Kind = ConflictChoice['kind'];

const options: { kind: Kind; label: string; icon: LucideIcon | null; hint: string }[] = [
  { kind: 'keep_new', label: 'Keep the newer one', icon: Replace, hint: 'The older fact becomes superseded.' },
  { kind: 'keep_old', label: 'Keep the older one', icon: null, hint: 'The newer fact is set aside.' },
  { kind: 'merge', label: 'Merge into one fact', icon: Merge, hint: 'Write one fact that is true now.' },
  { kind: 'keep_both', label: 'Keep both with context', icon: Columns2, hint: 'Add a note so both can stay true.' },
];

/** Two facts that disagree, and one decision (DESIGN 7.9). Real radios in a fieldset. */
export function ConflictCard({ older, newer, mergeSuggestion, maxLength, onResolve, resolving, error, className }: ConflictCardProps) {
  const name = useId();
  const [kind, setKind] = useState<Kind>('keep_new');
  const [merged, setMerged] = useState(mergeSuggestion);
  const [context, setContext] = useState('');

  const submit = () => {
    if (kind === 'merge') onResolve({ kind, text: merged.trim() });
    else if (kind === 'keep_both') onResolve({ kind, context: context.trim() });
    else onResolve({ kind });
  };
  const invalid = (kind === 'merge' && merged.trim().length === 0) || (kind === 'keep_both' && context.trim().length === 0);

  return (
    <article className={cn('rounded-md border border-border-hairline border-l-2 border-l-warning bg-surface-1 p-5 shadow-1', className)}>
      <header className="flex flex-wrap items-center gap-3">
        <StatusPill status="conflict" />
        <p className="text-body text-text-secondary">These two facts disagree. Pick what is true now.</p>
      </header>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {[
          { side: older, label: 'Older' },
          { side: newer, label: 'Newer' },
        ].map(({ side, label }) => (
          <div key={label} className="flex flex-col gap-3 rounded-sm border border-border-hairline bg-surface-2 p-4">
            <span className="text-small font-medium text-text-secondary">
              {label}, {side.date}
            </span>
            <p className="text-[0.9375rem] leading-6 text-text-primary [overflow-wrap:anywhere]">{side.text}</p>
            <SourceBadges vendors={side.sources} />
          </div>
        ))}
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-small font-medium text-text-secondary">How should Ferry remember this?</legend>
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const Icon = option.icon;
            const checked = kind === option.kind;
            return (
              <label
                key={option.kind}
                className={cn(
                  'flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 transition-colors duration-150 ease-out',
                  checked ? 'bg-accent-subtle' : 'hover:bg-surface-3',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.kind}
                  checked={checked}
                  onChange={() => setKind(option.kind)}
                  className="size-4 shrink-0 accent-[var(--ferry-accent)]"
                />
                {Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="text-text-secondary" /> : <span className="w-4" aria-hidden="true" />}
                <span className="text-body font-medium text-text-primary">{option.label}</span>
                <span className="hidden text-small text-text-secondary sm:inline">{option.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {kind === 'merge' ? (
        <Textarea
          fieldClassName="mt-4"
          label="Merged fact"
          value={merged}
          maxLength={maxLength}
          showCount
          onChange={(event) => setMerged(event.target.value)}
        />
      ) : null}
      {kind === 'keep_both' ? (
        <Input
          fieldClassName="mt-4"
          label="Context that makes both true"
          placeholder="at home, when travelling"
          maxLength={120}
          value={context}
          onChange={(event) => setContext(event.target.value)}
        />
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-small text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={submit} disabled={invalid} loading={resolving === true} loadingLabel="Resolving">
          Resolve conflict
        </Button>
      </div>
    </article>
  );
}
