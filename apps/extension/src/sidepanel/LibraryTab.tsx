import {
  BlobView,
  FACT_TYPES,
  MEMORY_STATUSES,
  VENDORS,
  type FactType,
  type MemoryStatus,
  type StoredMemory,
  type Vendor,
} from '@ferry/core';
import {
  Button,
  Dialog,
  EmptyState,
  FactCard,
  Notice,
  ReceiptDrawer,
  SearchInput,
  SkeletonGroup,
  Skeleton,
  VENDOR_LABEL,
  useToast,
  type ChainState,
  type VerifyState,
} from '@ferry/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { EyeOff, Library, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGGREGATOR_URL, API_ROUTES, FERRY_API_ORIGIN, SITE_BY_ORIGIN } from '../lib/config';
import type { LibraryItem, LibraryPage } from '@ferry/core';
import { call } from './client';

const TYPE_LABEL: Record<FactType, string> = {
  identity: 'Identity',
  preference: 'Preference',
  dislike: 'Dislike',
  person: 'Person',
  project: 'Project',
  goal: 'Goal',
  routine: 'Routine',
  decision: 'Decision',
  skill: 'Skill',
  constraint: 'Constraint',
  lesson: 'Lesson',
};

const STATUS_LABEL: Record<MemoryStatus, string> = {
  active: 'Active',
  superseded: 'Superseded',
  hidden: 'Hidden',
  conflict: 'Conflict',
  quarantine: 'Quarantined',
};

const SEARCH_DEBOUNCE_MS = 300;
/** Walrus mainnet epochs are 14 days. Used only to turn an end epoch into an approximate date. */
const EPOCH_MS = 14 * 86_400_000;

export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDate(iso)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: readonly { value: T; label: string }[];
  onChange: (v: T | '') => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-small font-medium text-text-secondary">{label}</span>
      <select
        className="h-8 rounded-sm border border-border-control bg-surface-2 px-2 text-body text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        value={value}
        onChange={(e) => onChange(e.target.value as T | '')}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

export function LibraryTab() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<FactType | ''>('');
  const [vendor, setVendor] = useState<Vendor | ''>('');
  const [status, setStatus] = useState<MemoryStatus | ''>('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [hiding, setHiding] = useState<LibraryItem | null>(null);
  const [hideBusy, setHideBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    async (after: string | null) => {
      if (after === null) setLoad({ kind: 'loading' });
      const res = await call<LibraryPage>({
        type: 'memory.list',
        ...(status !== '' ? { status } : {}),
        ...(debounced.length > 0 ? { query: debounced } : {}),
        ...(after !== null ? { cursor: after } : {}),
      });
      if (!res.ok) {
        setLoad({ kind: 'error', message: res.message });
        return;
      }
      setItems((prev) => (after === null ? res.data.items : [...prev, ...res.data.items]));
      setCursor(res.data.nextCursor);
      setLoad({ kind: 'ready' });
    },
    [status, debounced],
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (type === '' || i.memory.header.type === type) &&
          (vendor === '' || i.memory.header.sources.includes(vendor)),
      ),
    [items, type, vendor],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 148,
    overscan: 6,
  });

  const hide = async () => {
    if (hiding === null) return;
    setHideBusy(true);
    const res = await call({ type: 'memory.hide', ref: hiding.memory.ref });
    setHideBusy(false);
    if (!res.ok) {
      toast.show({ message: res.message, tone: 'error' });
      return;
    }
    setHiding(null);
    toast.show({ message: 'Hidden. It will not be inserted again.', tone: 'success' });
    void fetchPage(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <SearchInput
        label="Search your memory"
        value={query}
        onValueChange={setQuery}
        placeholder="vegetarian, Lisbon, TypeScript"
      />
      <div className="flex gap-2">
        <Select
          label="Type"
          value={type}
          options={FACT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          onChange={setType}
        />
        <Select
          label="Source"
          value={vendor}
          options={VENDORS.map((v) => ({ value: v, label: VENDOR_LABEL[v] }))}
          onChange={setVendor}
        />
        <Select
          label="Status"
          value={status}
          options={MEMORY_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          onChange={setStatus}
        />
      </div>

      {load.kind === 'loading' ? (
        <SkeletonGroup label="Loading library">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-md" />
          ))}
        </SkeletonGroup>
      ) : load.kind === 'error' ? (
        <Notice
          tone="danger"
          title="Could not load your library"
          live
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={RotateCw}
              onClick={() => void fetchPage(null)}
            >
              Try again
            </Button>
          }
        >
          {load.message}
        </Notice>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Library}
          title={
            debounced.length > 0 || type !== '' || vendor !== '' || status !== ''
              ? 'No facts match'
              : 'Your library is empty'
          }
        >
          {debounced.length > 0 || type !== '' || vendor !== '' || status !== ''
            ? 'Try a shorter search or clear a filter.'
            : 'Facts you save from chats, or rescue from a ChatGPT, Claude or Gemini export, show up here with a receipt for each one.'}
        </EmptyState>
      ) : (
        <div
          ref={scrollRef}
          className="h-[calc(100dvh-260px)] min-h-[320px] overflow-y-auto"
          aria-label="Facts"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = visible[row.index];
              if (item === undefined) return null;
              const m = item.memory;
              return (
                <div
                  key={m.ref}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <FactCard
                    typeLabel={TYPE_LABEL[m.header.type]}
                    text={m.text}
                    status={m.status}
                    sources={m.header.sources}
                    date={formatDate(m.header.at)}
                    confidence={m.header.confidence}
                    onOpenReceipt={() => setOpen(item)}
                    actions={
                      m.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={EyeOff}
                          onClick={() => setHiding(item)}
                        >
                          Hide
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
          {cursor !== null && debounced.length === 0 ? (
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => void fetchPage(cursor)}
            >
              Load more
            </Button>
          ) : null}
        </div>
      )}

      {open !== null ? <Receipt item={open} onClose={() => setOpen(null)} /> : null}

      <Dialog
        open={hiding !== null}
        onOpenChange={(o) => {
          if (!o) setHiding(null);
        }}
        title="Hide this fact?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setHiding(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={EyeOff}
              loading={hideBusy}
              loadingLabel="Hiding"
              onClick={() => void hide()}
            >
              Hide fact
            </Button>
          </>
        }
      >
        <p className="text-body text-text-secondary">{forgetCopy(hiding?.endEpoch ?? null)}</p>
      </Dialog>
    </div>
  );
}

/**
 * Receipt links come from stored data, so they are re-checked at render: https on one of the three
 * chat origins only, never a scheme or host the import chose (THREAT_MODEL X-URL-1, RT-25).
 */
export function safeConversationLink(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      SITE_BY_ORIGIN[parsed.origin] !== undefined &&
      parsed.username === '' &&
      parsed.password === ''
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** DESIGN 9.5, with the real epoch when the index knows it. */
export function forgetCopy(endEpoch: number | null): string {
  const until =
    endEpoch !== null
      ? `until its storage epoch ends: epoch ${endEpoch}`
      : 'until its storage epoch ends';
  return `Ferry will hide this fact everywhere and write a tombstone to Walrus, so no device of yours inserts it again. Walrus Memory has no delete, so the encrypted copy stays in Walrus storage ${until}. After that it is gone.`;
}

function Receipt({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const m: StoredMemory = item.memory;
  const receipt = m.receipts[0];
  const [chain, setChain] = useState<ChainState>({ status: 'loading' });
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [bytes, setBytes] = useState<number | null>(null);

  const readChain = useCallback(async () => {
    setChain({ status: 'loading' });
    const started = performance.now();
    try {
      const res = await fetch(`${FERRY_API_ORIGIN}${API_ROUTES.blob(item.blobId)}`, {
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const view = BlobView.parse(await res.json());
      const endLabel =
        view.endEpoch !== null
          ? `about ${formatDate(new Date(Date.now() + (view.endEpoch - view.currentEpoch) * EPOCH_MS).toISOString())}`
          : undefined;
      setChain({
        status: 'ready',
        blobId: view.blobId,
        owner: view.owner,
        certifiedEpoch: view.certifiedEpoch,
        endEpoch: view.endEpoch ?? item.endEpoch,
        ...(endLabel !== undefined ? { endLabel } : {}),
        readThrough: 'Tatum Sui gRPC',
        latencyMs: Math.round(performance.now() - started),
      });
    } catch {
      setChain({
        status: 'error',
        message: 'Could not read this blob from Sui through the Ferry chain proxy. Try again.',
        onRetry: () => void readChain(),
      });
    }
  }, [item.blobId, item.endEpoch]);

  useEffect(() => {
    void readChain();
  }, [readChain]);

  /** Refetches the blob from the Walrus aggregator, which only serves data that reconstructs to this id. */
  const runVerify = async () => {
    setVerify({ status: 'verifying' });
    try {
      const res = await fetch(`${AGGREGATOR_URL}/v1/blobs/${encodeURIComponent(item.blobId)}`, {
        credentials: 'omit',
      });
      if (res.status === 404) {
        setVerify({ status: 'mismatch' });
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.byteLength === 0) {
        setVerify({ status: 'mismatch' });
        return;
      }
      setBytes(body.byteLength);
      setVerify({
        status: 'verified',
        at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch {
      setVerify({ status: 'error', message: 'Could not reach the Walrus aggregator. Try again.' });
    }
  };

  return (
    <ReceiptDrawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      quote={receipt?.quote ?? m.text}
      sources={m.header.sources}
      saidAt={receipt !== undefined ? formatDateTime(receipt.messageAt) : formatDate(m.header.at)}
      conversationUrl={safeConversationLink(receipt?.conversationUrl)}
      chain={chain}
      verify={verify}
      onVerify={() => void runVerify()}
      extra={
        bytes !== null ? (
          <p className="text-small text-text-tertiary">
            Read back {bytes.toLocaleString('en-GB')} bytes of ciphertext from the Walrus
            aggregator.
          </p>
        ) : undefined
      }
    />
  );
}
