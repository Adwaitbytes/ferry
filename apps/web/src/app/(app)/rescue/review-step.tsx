'use client';

import { MAX_FACT_CHARS, type FactType, type Vendor } from '@ferry/core';
import { Button, cn, Dialog, EmptyState, FactCard, IconButton, Kbd, useToast } from '@ferry/ui';
import { AnimatePresence } from 'motion/react';
import { Check, Import, PencilLine, ShieldAlert, ShieldQuestion, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReceiptTarget } from '@/components/receipt';
import { FACT_TYPE_LABEL, FACT_TYPE_PLURAL, formatDate } from '@/lib/format';
import { SENSITIVE_LABEL, type ReviewFact } from './pipeline';

export type Decision = 'pending' | 'approved' | 'discarded';

export interface ReviewState {
  decisions: Record<string, Decision>;
  /** Sensitive facts the user explicitly included. Off by default (PRD F2.7). */
  included: Record<string, boolean>;
  edits: Record<string, string>;
}

type GroupKey = FactType | 'sensitive' | 'quarantine';

export function factsToMove(facts: readonly ReviewFact[], review: ReviewState): ReviewFact[] {
  return facts.filter((f) => {
    if (review.decisions[f.fact.id] === 'discarded') return false;
    if (f.group === 'normal') return true;
    if (f.group === 'sensitive') return review.included[f.fact.id] === true;
    return false;
  });
}

function vendorsOf(f: ReviewFact): Vendor[] {
  return f.fact.receipts.map((r) => r.vendor);
}

export function ReviewStep({
  facts,
  review,
  setReview,
  onMove,
  onReceipt,
}: {
  facts: readonly ReviewFact[];
  review: ReviewState;
  setReview: (update: (prev: ReviewState) => ReviewState) => void;
  onMove: () => void;
  onReceipt: (target: ReceiptTarget) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<GroupKey, ReviewFact[]>();
    for (const f of facts) {
      const key: GroupKey = f.group === 'normal' ? f.fact.type : f.group === 'quarantine' ? 'quarantine' : 'sensitive';
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    const typed = [...map.entries()].filter(([k]) => k !== 'sensitive' && k !== 'quarantine').sort((a, b) => b[1].length - a[1].length);
    return {
      typed,
      sensitive: map.get('sensitive') ?? [],
      quarantine: map.get('quarantine') ?? [],
    };
  }, [facts]);

  const [selected, setSelected] = useState<GroupKey>(() => groups.typed[0]?.[0] ?? 'sensitive');
  const visible = (
    selected === 'sensitive' ? groups.sensitive : selected === 'quarantine' ? groups.quarantine : (groups.typed.find(([k]) => k === selected)?.[1] ?? [])
  ).filter((f) => review.decisions[f.fact.id] !== 'discarded');
  const moving = factsToMove(facts, review);
  const totalFound = facts.filter((f) => f.group === 'normal' || f.group === 'sensitive').length;

  const decide = (id: string, decision: Decision) => setReview((prev) => ({ ...prev, decisions: { ...prev.decisions, [id]: decision } }));
  const discard = (f: ReviewFact) => {
    decide(f.fact.id, 'discarded');
    toast.show({ message: 'Discarded.', tone: 'info', action: { label: 'Undo', onAction: () => decide(f.fact.id, 'pending') } });
  };
  const openReceipt = (f: ReviewFact) =>
    onReceipt({ quote: f.fact.receipts[0]?.quote ?? f.fact.text, sources: vendorsOf(f), receipt: f.fact.receipts[0] ?? null, blobId: null });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], [role="dialog"]') || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = visible[Math.min(focus, visible.length - 1)];
      const key = event.key.toLowerCase();
      if (key === '?') setHelpOpen(true);
      else if (key === 'j') setFocus((i) => Math.min(i + 1, visible.length - 1));
      else if (key === 'k') setFocus((i) => Math.max(i - 1, 0));
      else if (!current) return;
      else if (key === 'a') decide(current.fact.id, 'approved');
      else if (key === 'e') setEditing(current.fact.id);
      else if (key === 'x') discard(current);
      else if (key === 'r') openReceipt(current);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (totalFound === 0 && groups.quarantine.length === 0) {
    return (
      <EmptyState icon={Import} title="No durable facts in this export">
        We did not find durable facts in this export. That happens with short or mostly work chats. Try another source or paste what an
        assistant says it knows about you.
      </EmptyState>
    );
  }

  const groupButton = (key: GroupKey, label: string, count: number, icon?: typeof ShieldQuestion) => {
    const Icon = icon;
    return (
      <li key={key}>
        <button
          type="button"
          aria-current={selected === key ? 'true' : undefined}
          onClick={() => {
            setSelected(key);
            setFocus(0);
          }}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-sm px-3 text-left text-body transition-colors duration-150 ease-out',
            selected === key ? 'bg-surface-3 font-medium text-text-primary' : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary',
          )}
        >
          {Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
          <span className="flex-1">{label}</span>
          <span className="tabular text-text-tertiary">{count}</span>
        </button>
      </li>
    );
  };

  const selectedType = selected !== 'sensitive' && selected !== 'quarantine' ? selected : null;
  const pendingInGroup = visible.filter((f) => review.decisions[f.fact.id] !== 'approved').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-title font-semibold text-text-primary">
          <span className="tabular">{totalFound.toLocaleString('en-US')}</span> facts found. Approve the ones that are true.
        </p>
        <button type="button" onClick={() => setHelpOpen(true)} className="inline-flex items-center gap-1.5 text-small text-text-tertiary hover:text-text-primary">
          Keyboard shortcuts <Kbd>?</Kbd>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Fact groups" className="lg:sticky lg:top-6 lg:self-start">
          <ul className="flex flex-col gap-0.5">
            {groups.typed.map(([key, list]) => groupButton(key, FACT_TYPE_LABEL[key as FactType], list.filter((f) => review.decisions[f.fact.id] !== 'discarded').length))}
          </ul>
          {groups.sensitive.length > 0 || groups.quarantine.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-0.5 border-t border-border-hairline pt-4">
              {groups.sensitive.length > 0 ? groupButton('sensitive', 'Sensitive, off by default', groups.sensitive.length, ShieldQuestion) : null}
              {groups.quarantine.length > 0 ? groupButton('quarantine', 'Quarantined', groups.quarantine.length, ShieldAlert) : null}
            </ul>
          ) : null}
        </nav>

        <section aria-label="Facts in this group" className="flex min-w-0 flex-col gap-3">
          {selectedType && pendingInGroup > 0 ? (
            <Button
              size="sm"
              icon={Check}
              className="self-start"
              onClick={() =>
                setReview((prev) => ({
                  ...prev,
                  decisions: { ...prev.decisions, ...Object.fromEntries(visible.map((f) => [f.fact.id, 'approved' as const])) },
                }))
              }
            >
              {`Approve all ${visible.length} ${FACT_TYPE_PLURAL[selectedType]}`}
            </Button>
          ) : null}
          {selected === 'quarantine' ? (
            <p className="text-body text-text-secondary">These looked like instructions to an AI, not facts about you. They will not be saved.</p>
          ) : null}
          {selected === 'sensitive' ? (
            <p className="text-body text-text-secondary">
              Health, money and similar details stay out unless you include them one by one. Card numbers, government ids, passwords and
              keys are always blocked.
            </p>
          ) : null}
          <AnimatePresence initial={false}>
            {visible.map((f, index) => {
              const id = f.fact.id;
              const decision = review.decisions[id] ?? 'pending';
              const receipt = f.fact.receipts[0];
              const blocked = f.group === 'blocked';
              const sensitiveLabel = f.fact.sensitive.map((c) => SENSITIVE_LABEL[c] ?? c).join(', ');
              return (
                <FactCard
                  key={id}
                  typeLabel={blocked ? `${sensitiveLabel}. Always blocked, never saved` : FACT_TYPE_LABEL[f.fact.type]}
                  text={review.edits[id] ?? f.fact.text}
                  status={f.group === 'quarantine' ? 'quarantine' : decision === 'approved' ? 'approved' : 'active'}
                  sources={vendorsOf(f)}
                  date={receipt ? formatDate(receipt.messageAt) : 'Date unknown'}
                  confidence={receipt?.confidence}
                  selected={index === focus}
                  onOpenReceipt={() => openReceipt(f)}
                  sensitive={
                    f.group === 'sensitive'
                      ? {
                          label: `${sensitiveLabel}. Include`,
                          included: review.included[id] === true,
                          onIncludedChange: (on) => setReview((prev) => ({ ...prev, included: { ...prev.included, [id]: on } })),
                        }
                      : undefined
                  }
                  editing={
                    editing === id
                      ? {
                          maxLength: MAX_FACT_CHARS,
                          onSave: (text) => {
                            setReview((prev) => ({ ...prev, edits: { ...prev.edits, [id]: text }, decisions: { ...prev.decisions, [id]: 'approved' } }));
                            setEditing(null);
                          },
                          onCancel: () => setEditing(null),
                        }
                      : undefined
                  }
                  actions={
                    f.group === 'quarantine' || blocked ? null : (
                      <>
                        <IconButton
                          icon={Check}
                          label={decision === 'approved' ? 'Approved' : 'Approve'}
                          size="sm"
                          aria-pressed={decision === 'approved'}
                          className={decision === 'approved' ? 'text-accent' : undefined}
                          onClick={() => decide(id, decision === 'approved' ? 'pending' : 'approved')}
                        />
                        <IconButton icon={PencilLine} label="Edit" size="sm" onClick={() => setEditing(id)} />
                        <IconButton icon={X} label="Discard" size="sm" onClick={() => discard(f)} />
                      </>
                    )
                  }
                />
              );
            })}
          </AnimatePresence>
        </section>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-hairline bg-surface-2 px-4 py-3 shadow-3">
        <p className="text-small text-text-secondary">
          Discarded and quarantined facts are never written. Sensitive facts move only if you include them.
        </p>
        <Button variant="primary" icon={Import} disabled={moving.length === 0} onClick={onMove}>
          {`Move ${moving.length.toLocaleString('en-US')} ${moving.length === 1 ? 'fact' : 'facts'} to Walrus`}
        </Button>
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Review shortcuts">
        <dl className="grid grid-cols-[48px_1fr] gap-y-2 text-body">
          {[
            ['J', 'Next fact'],
            ['K', 'Previous fact'],
            ['A', 'Approve'],
            ['E', 'Edit'],
            ['X', 'Discard'],
            ['R', 'Open receipt'],
          ].map(([key, label]) => (
            <div key={key} className="contents">
              <dt>
                <Kbd>{key}</Kbd>
              </dt>
              <dd className="text-text-secondary">{label}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  );
}
