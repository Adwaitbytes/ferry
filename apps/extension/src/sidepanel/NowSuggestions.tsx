import type {
  NowInserted,
  NowSuggestions as NowSuggestionsData,
  Site,
  Suggestion,
} from '@ferry/core';
import {
  Button,
  EmptyState,
  MonoId,
  Notice,
  Skeleton,
  SkeletonGroup,
  SourceBadges,
  VENDOR_LABEL,
  useToast,
} from '@ferry/ui';
import { CornerDownRight, ListPlus, MessageSquareText, ReceiptText, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SITE_LABEL } from '../lib/config';
import { call } from './client';
import { formatDate } from './LibraryTab';

/** Reading the worker's cache is free (no relayer call), so the panel can follow typing closely. */
const REFRESH_MS = 1500;

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: NowSuggestionsData };

function sameSuggestions(a: readonly Suggestion[], b: readonly Suggestion[]): boolean {
  return a.length === b.length && a.every((s, i) => s.ref === b[i]?.ref && s.text === b[i]?.text);
}

/** Follows the chat tab's own recall: whatever the chip would offer, the panel lists here. */
function useTabSuggestions(tabId: number | null): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const last = useRef<NowSuggestionsData | null>(null);

  useEffect(() => {
    if (tabId === null) return;
    let alive = true;
    last.current = null;
    setLoad({ kind: 'loading' });
    const fetchOnce = async () => {
      if (document.hidden) return;
      const res = await call<NowSuggestionsData>({ type: 'now.suggestions', tabId });
      if (!alive) return;
      if (!res.ok) {
        setLoad({ kind: 'error', message: res.message });
        return;
      }
      const prev = last.current;
      if (
        prev !== null &&
        prev.updatedAt === res.data.updatedAt &&
        sameSuggestions(prev.suggestions, res.data.suggestions)
      )
        return;
      last.current = res.data;
      setLoad({ kind: 'ready', data: res.data });
    };
    void fetchOnce();
    const timer = setInterval(() => void fetchOnce(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tabId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, retry };
}

function factCount(n: number): string {
  return `${n} ${n === 1 ? 'fact' : 'facts'}`;
}

function SuggestionRow({
  suggestion,
  busy,
  disabled,
  onInsert,
}: {
  suggestion: Suggestion;
  busy: boolean;
  disabled: boolean;
  onInsert: () => void;
}) {
  const [open, setOpen] = useState(false);
  const receiptId = useId();
  const textId = useId();
  const heardIn = suggestion.sources.map((v) => VENDOR_LABEL[v]).join(' and ');

  return (
    <li>
      <article aria-labelledby={textId} className="flex flex-col gap-3 px-4 py-3">
        <p id={textId} className="text-body text-text-primary [overflow-wrap:anywhere]">
          {suggestion.text}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
            <SourceBadges vendors={suggestion.sources} />
            <span className="text-small text-text-tertiary tabular-nums">
              {formatDate(suggestion.heardAt)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={ReceiptText}
              aria-expanded={open}
              aria-controls={receiptId}
              onClick={() => setOpen((o) => !o)}
            >
              Receipt
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={CornerDownRight}
              loading={busy}
              loadingLabel="Inserting"
              disabled={disabled}
              aria-describedby={textId}
              onClick={onInsert}
            >
              Insert
            </Button>
          </span>
        </div>
        <div id={receiptId} hidden={!open}>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-sm border border-border-hairline bg-surface-2 px-3 py-3 text-small">
            <dt className="text-text-secondary">Heard in</dt>
            <dd className="text-text-primary">{heardIn}</dd>
            <dt className="text-text-secondary">Heard on</dt>
            <dd className="text-text-primary tabular-nums">{formatDate(suggestion.heardAt)}</dd>
            <dt className="text-text-secondary">Walrus blob</dt>
            <dd className="min-w-0">
              <MonoId value={suggestion.ref} kind="Walrus blob" />
            </dd>
          </dl>
          <p className="mt-2 text-small text-text-tertiary">
            Open it in Library to see the quote and verify the blob on Walrus.
          </p>
        </div>
      </article>
    </li>
  );
}

export function NowSuggestions({
  site,
  tabId,
  injectOn,
}: {
  site: Site;
  tabId: number | null;
  injectOn: boolean;
}) {
  const toast = useToast();
  const { load, retry } = useTabSuggestions(injectOn ? tabId : null);
  const [inserting, setInserting] = useState<'all' | string | null>(null);
  const assistant = SITE_LABEL[site];

  const insert = async (refs: string[], key: 'all' | string) => {
    if (tabId === null || refs.length === 0) return;
    setInserting(key);
    const res = await call<NowInserted>({ type: 'now.insert', tabId, refs });
    setInserting(null);
    if (res.ok) toast.show({ message: `Added ${factCount(res.data.inserted)}`, tone: 'success' });
    else toast.show({ message: res.message, tone: 'error' });
  };

  let body: ReactNode;
  if (!injectOn) {
    body = (
      <p className="text-body text-text-tertiary">
        Offering context is off for {assistant}. Turn it on above and Ferry lists the facts that fit
        your message here.
      </p>
    );
  } else if (tabId === null || load.kind === 'loading') {
    body = (
      <SkeletonGroup label="Reading suggestions for this message" className="flex flex-col gap-2">
        <Skeleton className="h-[92px] rounded-md" />
        <Skeleton className="h-[92px] rounded-md" />
      </SkeletonGroup>
    );
  } else if (load.kind === 'error') {
    body = (
      <Notice
        tone="danger"
        title="Could not read suggestions"
        live
        action={
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={retry}>
            Try again
          </Button>
        }
      >
        {load.message}
      </Notice>
    );
  } else if (load.data.suggestions.length === 0) {
    body = (
      <EmptyState icon={MessageSquareText} title="Nothing to suggest yet">
        Start typing in {assistant} and Ferry will offer facts that fit. Insert only happens when
        you choose it.
      </EmptyState>
    );
  } else {
    const { suggestions } = load.data;
    body = (
      <ul
        aria-label={`Facts for this ${assistant} message`}
        className="flex flex-col divide-y divide-border-hairline rounded-md border border-border-hairline bg-surface-1 shadow-1"
      >
        {suggestions.map((s) => (
          <SuggestionRow
            key={s.ref}
            suggestion={s}
            busy={inserting === s.ref}
            disabled={inserting !== null && inserting !== s.ref}
            onInsert={() => void insert([s.ref], s.ref)}
          />
        ))}
      </ul>
    );
  }

  const count = load.kind === 'ready' && injectOn ? load.data.suggestions.length : 0;

  return (
    <section aria-labelledby="ferry-now-facts" className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id="ferry-now-facts" className="text-body font-semibold text-text-primary">
          For this message
        </h2>
        {count > 0 && load.kind === 'ready' ? (
          <Button
            variant="primary"
            size="sm"
            icon={ListPlus}
            loading={inserting === 'all'}
            loadingLabel="Inserting"
            disabled={inserting !== null && inserting !== 'all'}
            onClick={() =>
              void insert(
                load.data.suggestions.map((s) => s.ref),
                'all',
              )
            }
          >
            {count === 1 ? 'Insert' : `Insert all ${count}`}
          </Button>
        ) : null}
      </div>
      {count > 0 ? (
        <p className="text-small text-text-tertiary">
          Matched to what you are typing in {assistant}. Insert adds a marked context block at the
          start of your message; nothing is sent until you send it.
        </p>
      ) : null}
      {body}
    </section>
  );
}
