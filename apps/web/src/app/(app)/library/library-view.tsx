'use client';

import { FACT_TYPES, MAX_FACT_CHARS, VENDORS, type FactType, type MemoryStatus, type StoredMemory, type Suggestion, type Vendor } from '@ferry/core';
import {
  Button,
  ConflictCard,
  Dialog,
  EmptyState,
  IconButton,
  LoadingText,
  Notice,
  SearchInput,
  Skeleton,
  SkeletonGroup,
  SourceBadges,
  StatusPill,
  TabPanel,
  Tabs,
  useToast,
  VENDOR_LABEL,
  type ConflictChoice,
} from '@ferry/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { EyeOff, GitCompareArrows, History, Library, Receipt, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/app-shell';
import { ExtensionGate } from '@/components/extension-gate';
import { ReceiptView, type ReceiptTarget } from '@/components/receipt';
import { BridgeError, bridge, type LibraryItem } from '@/lib/bridge';
import { FACT_TYPE_LABEL, formatDate, formatMonth } from '@/lib/format';
import { useDelayed } from '@/lib/use-resource';

type TabValue = 'all' | 'conflicts' | 'hidden' | 'quarantine';
type ViewMode = 'list' | 'timeline';

interface Filters {
  type: FactType | '';
  vendor: Vendor | '';
  status: MemoryStatus | '';
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { type: '', vendor: '', status: '', from: '', to: '' };
const ROW_HEIGHT = 56;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; coolingDownMs?: number }
  | { kind: 'ready' };

function useLibrary() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (after?: string) => {
    if (after) setLoadingMore(true);
    else setState({ kind: 'loading' });
    try {
      const page = await bridge({ type: 'memory.list', ...(after ? { cursor: after } : {}) });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setState({ kind: 'ready' });
    } catch (error) {
      if (error instanceof BridgeError && error.kind === 'cooling_down') {
        setState({ kind: 'error', message: error.message, coolingDownMs: error.retryAfterMs ?? 40_000 });
      } else {
        setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read your library.' });
      }
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The list is read from the extension's local index, so pages are cheap: keep loading until
  // every fact is here, so counts and filters always cover the whole library.
  useEffect(() => {
    if (cursor && state.kind === 'ready' && !loadingMore) void load(cursor);
  }, [cursor, state.kind, loadingMore, load]);

  return { items, setItems, cursor, state, loadingMore, reload: () => void load(), loadMore: () => cursor && void load(cursor) };
}

function inDateRange(iso: string, from: string, to: string): boolean {
  const day = iso.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

function sourcesOf(memory: StoredMemory): Vendor[] {
  return memory.header.sources;
}

/* ---------------------------------------------------------------- */

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | '';
  onChange: (value: T | '') => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-small font-medium text-text-secondary">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          const next = options.find((o) => o.value === event.target.value);
          onChange(next ? next.value : '');
        }}
        className="h-9 rounded-sm border border-border-control bg-surface-2 px-2.5 text-body text-text-primary hover:border-text-tertiary"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-small font-medium text-text-secondary">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-sm border border-border-control bg-surface-2 px-2.5 text-body text-text-primary hover:border-text-tertiary"
      />
    </label>
  );
}

function FilterBar({ filters, setFilters, showStatus }: { filters: Filters; setFilters: (f: Filters) => void; showStatus: boolean }) {
  const applied: { key: keyof Filters; label: string }[] = [];
  if (filters.type) applied.push({ key: 'type', label: FACT_TYPE_LABEL[filters.type] });
  if (filters.vendor) applied.push({ key: 'vendor', label: VENDOR_LABEL[filters.vendor] });
  if (filters.status) applied.push({ key: 'status', label: `Status: ${filters.status}` });
  if (filters.from) applied.push({ key: 'from', label: `From ${formatDate(filters.from)}` });
  if (filters.to) applied.push({ key: 'to', label: `To ${formatDate(filters.to)}` });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <FilterSelect
          label="Type"
          value={filters.type}
          onChange={(type) => setFilters({ ...filters, type })}
          options={FACT_TYPES.map((t) => ({ value: t, label: FACT_TYPE_LABEL[t] }))}
        />
        <FilterSelect
          label="Source"
          value={filters.vendor}
          onChange={(vendor) => setFilters({ ...filters, vendor })}
          options={VENDORS.map((v) => ({ value: v, label: VENDOR_LABEL[v] }))}
        />
        {showStatus ? (
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(status) => setFilters({ ...filters, status })}
            options={(['active', 'superseded', 'conflict'] as const).map((s) => ({ value: s, label: s[0]?.toUpperCase() + s.slice(1) }))}
          />
        ) : (
          <div className="hidden md:block" />
        )}
        <DateInput label="From" value={filters.from} onChange={(from) => setFilters({ ...filters, from })} />
        <DateInput label="To" value={filters.to} onChange={(to) => setFilters({ ...filters, to })} />
      </div>
      {applied.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {applied.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setFilters({ ...filters, [a.key]: '' })}
              aria-label={`Remove filter ${a.label}`}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-subtle pl-2.5 pr-1.5 text-small font-medium text-accent hover:bg-surface-3"
            >
              {a.label}
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
          <Button variant="link" size="sm" className="text-small" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */

interface RowActions {
  onReceipt: (item: LibraryItem) => void;
  onHide: (item: LibraryItem) => void;
  onTimeline: (item: LibraryItem) => void;
}

function FactRow({ item, actions }: { item: LibraryItem; actions: RowActions }) {
  const m = item.memory;
  return (
    <article
      aria-label={m.text}
      className="grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border-hairline px-4 hover:bg-surface-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden w-24 shrink-0 text-small text-text-tertiary sm:inline">{FACT_TYPE_LABEL[m.header.type]}</span>
        <p
          className={
            m.status === 'hidden'
              ? 'truncate text-body text-text-tertiary line-through'
              : m.status === 'superseded'
                ? 'truncate text-body text-text-secondary'
                : 'truncate text-body text-text-primary'
          }
          title={m.text}
        >
          {m.text}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden md:inline-flex">
          <SourceBadges vendors={sourcesOf(m)} />
        </span>
        <span className="tabular hidden text-small text-text-tertiary lg:inline">{formatDate(m.header.at)}</span>
        {m.status !== 'active' ? <StatusPill status={m.status} /> : null}
        <IconButton icon={History} label="How this fact changed" size="sm" onClick={() => actions.onTimeline(item)} />
        {m.status === 'active' ? <IconButton icon={EyeOff} label="Hide this fact" size="sm" onClick={() => actions.onHide(item)} /> : null}
        <IconButton icon={Receipt} label="Open receipt" size="sm" onClick={() => actions.onReceipt(item)} />
      </div>
    </article>
  );
}

function VirtualList({ items, actions, label }: { items: readonly LibraryItem[]; actions: RowActions; label: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  return (
    <div
      ref={parentRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-[calc(100dvh-360px)] min-h-[280px] overflow-y-auto rounded-md border border-border-hairline bg-surface-1"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (!item) return null;
          return (
            <div key={item.memory.ref} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start}px)` }}>
              <FactRow item={item} actions={actions} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineByMonth({ items, actions }: { items: readonly LibraryItem[]; actions: RowActions }) {
  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    for (const item of [...items].sort((a, b) => b.memory.writtenAt.localeCompare(a.memory.writtenAt))) {
      const key = formatMonth(item.memory.writtenAt);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);
  return (
    <ol className="flex flex-col gap-8">
      {groups.map(([month, group]) => (
        <li key={month}>
          <h3 className="mb-3 text-body font-medium text-text-secondary">
            {month} <span className="tabular text-text-tertiary">{group.length}</span>
          </h3>
          <div className="overflow-hidden rounded-md border border-border-hairline bg-surface-1">
            {group.map((item) => (
              <FactRow key={item.memory.ref} item={item} actions={actions} />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Versions of one fact, newest first, joined by supersede links (DESIGN 8.4 timeline). */
function versionChain(start: LibraryItem, all: readonly LibraryItem[]): LibraryItem[] {
  const byRef = new Map(all.map((i) => [i.memory.ref, i]));
  let newest = start;
  const seen = new Set<string>();
  while (newest.memory.supersededBy && byRef.has(newest.memory.supersededBy) && !seen.has(newest.memory.ref)) {
    seen.add(newest.memory.ref);
    newest = byRef.get(newest.memory.supersededBy) ?? newest;
  }
  const chain: LibraryItem[] = [newest];
  let cursor = newest;
  while (cursor.memory.header.supersedes && byRef.has(cursor.memory.header.supersedes) && chain.length < 50) {
    const prev = byRef.get(cursor.memory.header.supersedes);
    if (!prev || chain.includes(prev)) break;
    chain.push(prev);
    cursor = prev;
  }
  return chain;
}

function TimelineDialog({ item, all, onClose }: { item: LibraryItem | null; all: readonly LibraryItem[]; onClose: () => void }) {
  const chain = item ? versionChain(item, all) : [];
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()} title="How this fact changed" size="md">
      {chain.length <= 1 ? (
        <p className="text-body text-text-secondary">This fact has one version. When a newer fact replaces it, both appear here with their sources.</p>
      ) : null}
      <ol className="relative flex flex-col gap-5 pl-6 before:absolute before:bottom-2 before:left-[3.5px] before:top-2 before:w-px before:bg-border-strong">
        {chain.map((version) => {
          const s = version.memory.status;
          return (
            <li key={version.memory.ref} className="relative flex flex-col gap-1.5">
              {s === 'hidden' ? (
                <svg aria-hidden="true" viewBox="0 0 8 8" className="absolute -left-6 top-1.5 size-2 text-text-tertiary">
                  <circle cx="4" cy="4" r="3.5" fill="var(--ferry-surface-1)" stroke="currentColor" />
                  <path d="M1.5 6.5l5-5" stroke="currentColor" />
                </svg>
              ) : null}
              <span
                aria-hidden="true"
                className={
                  s === 'hidden'
                    ? 'hidden'
                    : s === 'active'
                      ? 'absolute -left-6 top-1.5 size-2 rounded-full bg-accent'
                      : 'absolute -left-6 top-1.5 size-2 rounded-full border border-text-secondary bg-surface-1'
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={s} />
                <SourceBadges vendors={sourcesOf(version.memory)} />
                <span className="text-small text-text-tertiary">{formatDate(version.memory.header.at)}</span>
              </div>
              <p className={s === 'active' ? 'text-body text-text-primary' : 'text-body text-text-secondary'}>{version.memory.text}</p>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}

function HideDialog({ item, onClose, onHidden }: { item: LibraryItem | null; onClose: () => void; onHidden: (item: LibraryItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = item?.endEpoch;
  const confirm = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await bridge({ type: 'memory.hide', ref: item.memory.ref });
      onHidden(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hide this fact.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Hide this fact?"
      description={
        <>
          Ferry will hide this fact everywhere and write a tombstone to Walrus, so no device of yours inserts it again. Walrus Memory
          has no delete, so the encrypted copy stays in Walrus storage until its storage epoch ends
          {epoch !== null && epoch !== undefined ? `: epoch ${epoch}` : ''}. After that it is gone.
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={EyeOff} loading={busy} loadingLabel="Hiding" onClick={() => void confirm()}>
            Hide fact
          </Button>
        </>
      }
    >
      {item ? <p className="rounded-sm bg-surface-2 px-3 py-2 text-body text-text-primary">{item.memory.text}</p> : null}
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function ConflictInbox({ items, onResolved }: { items: readonly LibraryItem[]; onResolved: (ref: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const conflicts = items.filter((i) => i.memory.status === 'conflict' && i.conflict);

  if (conflicts.length === 0) {
    return (
      <EmptyState icon={GitCompareArrows} title="No conflicts">
        When two facts disagree, Ferry puts them here for you to decide.
      </EmptyState>
    );
  }

  const resolve = async (item: LibraryItem, choice: ConflictChoice) => {
    const conflict = item.conflict;
    if (!conflict) return;
    // The stored memory is always the older side: the incoming fact is held until this choice.
    const resolution =
      choice.kind === 'keep_new'
        ? { kind: 'keep_new' as const, supersede: item.memory.ref }
        : choice.kind === 'keep_old'
          ? { kind: 'keep_old' as const }
          : choice.kind === 'merge'
            ? { kind: 'merge' as const, text: choice.text, supersede: item.memory.ref }
            : { kind: 'keep_both' as const, context: choice.context };
    setBusy(item.memory.ref);
    try {
      await bridge({ type: 'memory.resolve', conflictId: conflict.conflictId, resolution });
      toast.show({ message: 'Resolved. The older fact is superseded and will not be inserted again.' });
      onResolved(item.memory.ref);
    } catch (e) {
      setErrors((prev) => ({ ...prev, [item.memory.ref]: e instanceof Error ? e.message : 'Could not resolve this conflict.' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {conflicts.map((item) => {
        const other = item.conflict;
        if (!other) return null;
        const older = item.memory;
        return (
          <ConflictCard
            key={item.memory.ref}
            older={{ text: older.text, sources: sourcesOf(older), date: formatMonth(older.header.at) }}
            newer={{ text: other.otherText, sources: other.otherSources, date: formatMonth(other.otherHeardAt) }}
            mergeSuggestion={other.otherText}
            maxLength={MAX_FACT_CHARS}
            resolving={busy === item.memory.ref}
            error={errors[item.memory.ref] ?? null}
            onResolve={(choice) => void resolve(item, choice)}
          />
        );
      })}
    </div>
  );
}

function LoadingRows() {
  const slow = useDelayed(true, 4000);
  const show = useDelayed(true, 150);
  if (!show) return null;
  return (
    <SkeletonGroup label="Loading library" className="overflow-hidden rounded-md border border-border-hairline bg-surface-1">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-4 border-b border-border-hairline px-4 last:border-0">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
      {slow ? <LoadingText className="px-4 py-3">Rebuilding your index from Walrus. Large libraries take a minute.</LoadingText> : null}
    </SkeletonGroup>
  );
}

/* ---------------------------------------------------------------- */

function LibraryScreen() {
  const toast = useToast();
  const lib = useLibrary();
  const [tab, setTab] = useState<TabValue>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ status: 'idle' | 'loading' | 'error' | 'ready'; results: Suggestion[]; message?: string }>({
    status: 'idle',
    results: [],
  });
  const [receipt, setReceipt] = useState<ReceiptTarget | null>(null);
  const [hideTarget, setHideTarget] = useState<LibraryItem | null>(null);
  const [timelineTarget, setTimelineTarget] = useState<LibraryItem | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      searchRef.current?.querySelector('input')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearch({ status: 'idle', results: [] });
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearch((s) => ({ ...s, status: 'loading' }));
      bridge({ type: 'memory.recall', query: q, limit: 20 }).then(
        (results) => active && setSearch({ status: 'ready', results }),
        (e: unknown) =>
          active &&
          setSearch({
            status: 'error',
            results: [],
            message:
              e instanceof BridgeError && e.kind === 'cooling_down'
                ? `Walrus Memory is cooling down after many requests. Search resumes in ${Math.ceil((e.retryAfterMs ?? 40_000) / 1000)}s.`
                : e instanceof Error
                  ? e.message
                  : 'Search failed.',
          }),
      );
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const counts = useMemo(() => {
    const c = { conflicts: 0, hidden: 0, quarantine: 0 };
    for (const i of lib.items) {
      if (i.memory.status === 'conflict') c.conflicts++;
      else if (i.memory.status === 'hidden') c.hidden++;
      else if (i.memory.status === 'quarantine') c.quarantine++;
    }
    return c;
  }, [lib.items]);

  const filtered = useMemo(() => {
    const byTab = lib.items.filter((i) => {
      const s = i.memory.status;
      if (tab === 'hidden') return s === 'hidden';
      if (tab === 'quarantine') return s === 'quarantine';
      return s !== 'hidden' && s !== 'quarantine';
    });
    let base = byTab;
    if (search.status === 'ready') {
      const byRef = new Map(byTab.map((i) => [i.memory.ref, i]));
      base = search.results.flatMap((r) => {
        const hit = byRef.get(r.ref);
        return hit ? [hit] : [];
      });
    }
    return base.filter(
      (i) =>
        (!filters.type || i.memory.header.type === filters.type) &&
        (!filters.vendor || i.memory.header.sources.includes(filters.vendor)) &&
        (!filters.status || i.memory.status === filters.status) &&
        inDateRange(i.memory.header.at, filters.from, filters.to),
    );
  }, [lib.items, tab, search, filters]);

  const actions: RowActions = {
    onReceipt: (item) =>
      setReceipt({
        quote: item.memory.text,
        sources: sourcesOf(item.memory),
        receipt: item.memory.receipts[0] ?? null,
        blobId: item.blobId,
      }),
    onHide: setHideTarget,
    onTimeline: setTimelineTarget,
  };

  let body: ReactNode;
  if (lib.state.kind === 'loading') body = <LoadingRows />;
  else if (lib.items.length === 0 && lib.state.kind === 'ready') {
    body = (
      <EmptyState
        icon={Library}
        title="Your library is empty"
        action={
          <Link href="/rescue" className="inline-flex h-9 items-center rounded-sm bg-accent px-3.5 text-body font-medium text-accent-fg hover:bg-accent-hover">
            Rescue an export
          </Link>
        }
        secondary={
          <Link href="/settings#saving" className="text-body text-accent underline-offset-[3px] hover:underline">
            How saving works
          </Link>
        }
      >
        Facts appear here when you rescue an export or save something from a chat.
      </EmptyState>
    );
  } else if (search.status === 'ready' && filtered.length === 0) {
    body = (
      <EmptyState icon={Library} title={`Nothing matches “${query.trim()}”`}>
        Search looks at meaning, so try a broader word like &ldquo;diet&rdquo;.
      </EmptyState>
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState icon={tab === 'quarantine' ? ShieldAlert : tab === 'hidden' ? EyeOff : Library} title="Nothing here">
        {tab === 'hidden'
          ? 'Hidden facts appear here. Ferry never inserts them again, and Walrus drops them when their storage epoch ends.'
          : tab === 'quarantine'
            ? 'Text that looked like instructions to an AI lands here instead of your memory. Nothing is quarantined right now.'
            : 'No facts match these filters. Clear a filter to see more.'}
      </EmptyState>
    );
  } else {
    body =
      view === 'list' ? (
        <VirtualList items={filtered} actions={actions} label="Facts" />
      ) : (
        <TimelineByMonth items={filtered} actions={actions} />
      );
  }

  return (
    <>
      <PageHeader title="Library">Everything Ferry remembers about you, with where each fact came from.</PageHeader>

      {lib.state.kind === 'error' ? (
        <Notice
          tone="warning"
          live
          className="mb-6"
          action={
            <Button size="sm" onClick={lib.reload}>
              Try again
            </Button>
          }
        >
          {lib.state.coolingDownMs
            ? `Walrus Memory is cooling down after many requests. Try again in ${Math.ceil(lib.state.coolingDownMs / 1000)}s.`
            : `Could not reach the Walrus Memory relayer. ${lib.items.length > 0 ? 'Your local copy is shown and may be out of date.' : lib.state.message}`}
        </Notice>
      ) : null}

      <Tabs<TabValue>
        label="Library sections"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'all', label: 'All' },
          { value: 'conflicts', label: 'Conflicts', count: counts.conflicts },
          { value: 'hidden', label: 'Hidden', count: counts.hidden },
          { value: 'quarantine', label: 'Quarantine', count: counts.quarantine },
        ]}
      >
        {(['all', 'hidden', 'quarantine'] as const).map((value) => (
          <TabPanel key={value} value={value}>
            {tab === value ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div ref={searchRef} className="flex-1">
                    <SearchInput
                      label="Search your memory by meaning"
                      placeholder="Search by meaning, for example diet or Lisbon"
                      value={query}
                      onValueChange={setQuery}
                    />
                  </div>
                  <div role="radiogroup" aria-label="View" className="inline-flex h-9 shrink-0 rounded-sm border border-border-hairline bg-surface-2 p-0.5">
                    {(['list', 'timeline'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={view === mode}
                        onClick={() => setView(mode)}
                        className={
                          view === mode
                            ? 'rounded-[5px] bg-surface-1 px-3 text-body font-medium text-text-primary shadow-1'
                            : 'rounded-[5px] px-3 text-body font-medium text-text-secondary hover:text-text-primary'
                        }
                      >
                        {mode === 'list' ? 'List' : 'Timeline'}
                      </button>
                    ))}
                  </div>
                </div>
                <FilterBar filters={filters} setFilters={setFilters} showStatus={value === 'all'} />
                <div aria-live="polite" className="text-small text-text-tertiary">
                  {search.status === 'loading' ? (
                    <LoadingText>Searching your memory</LoadingText>
                  ) : search.status === 'error' ? (
                    <span className="text-danger">{search.message}</span>
                  ) : search.status === 'ready' ? (
                    `${filtered.length} ${filtered.length === 1 ? 'fact matches' : 'facts match'} by meaning`
                  ) : lib.state.kind === 'ready' ? (
                    `${filtered.length.toLocaleString('en-US')} of ${lib.items.length.toLocaleString('en-US')} facts`
                  ) : null}
                </div>
                {body}
                {lib.cursor && lib.state.kind === 'ready' ? (
                  <Button className="self-start" loading={lib.loadingMore} loadingLabel="Loading more" onClick={lib.loadMore}>
                    Load more facts
                  </Button>
                ) : null}
              </div>
            ) : null}
          </TabPanel>
        ))}
        <TabPanel value="conflicts">
          {lib.state.kind === 'loading' ? (
            <LoadingRows />
          ) : (
            <ConflictInbox
              items={lib.items}
              onResolved={(ref) => lib.setItems((prev) => prev.map((i) => (i.memory.ref === ref ? { ...i, memory: { ...i.memory, status: 'active' } } : i)))}
            />
          )}
        </TabPanel>
      </Tabs>

      <ReceiptView
        target={receipt}
        onClose={() => setReceipt(null)}
        onHistory={() => {
          const item = lib.items.find((i) => i.blobId === receipt?.blobId) ?? null;
          setReceipt(null);
          setTimelineTarget(item);
        }}
      />
      <HideDialog
        item={hideTarget}
        onClose={() => setHideTarget(null)}
        onHidden={(item) => {
          setHideTarget(null);
          lib.setItems((prev) => prev.map((i) => (i.memory.ref === item.memory.ref ? { ...i, memory: { ...i.memory, status: 'hidden' } } : i)));
          toast.show({ message: 'Hidden. It will not be inserted again.' });
        }}
      />
      <TimelineDialog item={timelineTarget} all={lib.items} onClose={() => setTimelineTarget(null)} />
    </>
  );
}

export function LibraryView() {
  return <ExtensionGate title="Library">{() => <LibraryScreen />}</ExtensionGate>;
}
