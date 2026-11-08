'use client';

import type { MemoryRef } from '@ferry/core';
import {
  Button,
  CodeBlock,
  Counter,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  LoadingText,
  MonoId,
  Notice,
  Textarea,
  Toggle,
  useToast,
  VerifyCheck,
} from '@ferry/ui';
import { spring } from '@ferry/ui/motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Contact, HandCoins, RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useExtension } from '@/components/extension-context';
import { WalletPicker } from '@/components/wallet';
import { formatUsdc, gateConfigured, getEarnings, type Earnings } from '@/lib/api';
import { bridge, type LibraryItem } from '@/lib/bridge';
import { publicEnv } from '@/lib/env';
import { FACT_TYPE_LABEL, formatDateTime, formatTime } from '@/lib/format';
import { explorer } from '@/lib/links';
import { useResource } from '@/lib/use-resource';

const TRIPSCOUT = `// TripScout: a travel agent that buys one fact from a Ferry Share Card for 0.01 USDC on Sui.
import { ferry } from '@ferry/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const key = process.env['TRIPSCOUT_PRIVATE_KEY'];
const cardId = process.env['TRIPSCOUT_CARD_ID'];
if (!key?.startsWith('suiprivkey') || !cardId) throw new Error('Set TRIPSCOUT_PRIVATE_KEY and TRIPSCOUT_CARD_ID.');
const payer = Ed25519Keypair.fromSecretKey(key);

const { results, payment } = await ferry.card(cardId).recall('food preferences', { payer });
for (const fact of results) console.log(\`- \${fact.text} (heard in \${fact.sources.join(', ')})\`);
console.log(\`Paid \${Number(payment.amountMicros) / 1e6} USDC, receipt \${payment.receiptId}\`);
console.log(\`https://suiscan.xyz/mainnet/tx/\${payment.digest}\`);`;

const EXPLAINER_KEY = 'ferry-share-explainer-dismissed';
const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
/** Up to 6 whole digits and 6 decimals (USDC has 6). Split instead of one regex to keep it linear. */
function isPrice(value: string): boolean {
  const [whole, frac, extra] = value.split('.');
  return extra === undefined && /^\d{1,6}$/.test(whole ?? '') && (frac === undefined || /^\d{1,6}$/.test(frac));
}

function Explainer() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(EXPLAINER_KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  return (
    <Notice
      tone="info"
      className="mb-8"
      action={
        <IconButton
          icon={X}
          label="Dismiss explanation"
          size="sm"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(EXPLAINER_KEY, '1');
            } catch {
              // Storage can be blocked; the notice simply returns next visit.
            }
          }}
        />
      }
    >
      Shared facts live in a separate Public profile account that you also own. Ferry Gate holds a key only for that account, so it can
      never read your private memory. Agents pay you directly in USDC on Sui. Ferry never holds the money.
    </Notice>
  );
}

/* ---------------------------------------------------------------- */

interface CardDraft {
  name: string;
  scope: string;
  price: string;
  dailyCap: string;
  agents: string;
  live: boolean;
  refs: MemoryRef[];
}

function validate(draft: CardDraft): Partial<Record<keyof CardDraft, string>> {
  const errors: Partial<Record<keyof CardDraft, string>> = {};
  if (!draft.name.trim()) errors.name = 'Give the card a name, for example Food preferences.';
  if (!isPrice(draft.price) || Number(draft.price) <= 0) errors.price = 'Enter a price above 0, with up to 6 decimals, for example 0.01.';
  if (!/^\d{1,6}$/.test(draft.dailyCap) || Number(draft.dailyCap) < 1) errors.dailyCap = 'Enter a whole number of recalls per day, 1 or more.';
  const bad = draft.agents
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !ADDRESS_RE.test(l));
  if (bad.length > 0) errors.agents = `${bad.length === 1 ? 'This line is' : 'These lines are'} not a Sui address: ${bad.slice(0, 2).join(', ')}`;
  if (draft.refs.length === 0) errors.refs = 'Pick at least one fact to share.';
  return errors;
}

function CardEditor({ owner }: { owner: string | null }) {
  const toast = useToast();
  const { state } = useExtension();
  const ready = state.kind === 'ready' && state.status.paired && !state.status.locked;
  const facts = useResource(ready ? () => bridge({ type: 'memory.list', status: 'active' }) : null, ready ? 'share-facts' : 'off');
  const [draft, setDraft] = useState<CardDraft>({ name: '', scope: '', price: '0.01', dailyCap: '100', agents: '', live: true, refs: [] });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const errors = touched ? validate(draft) : {};
  const items: LibraryItem[] = facts.status === 'ready' ? facts.data.items.filter((i) => i.memory.status === 'active') : [];

  const save = async () => {
    setTouched(true);
    if (Object.keys(validate(draft)).length > 0 || !owner || !publicEnv.gateUrl) return;
    setSaving(true);
    setSaveError(null);
    const chosen = items.filter((i) => draft.refs.includes(i.memory.ref));
    try {
      const response = await fetch(`${publicEnv.gateUrl}/v1/cards`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner,
          name: draft.name.trim(),
          scope: draft.scope.trim(),
          priceMicros: String(Math.round(Number(draft.price) * 1_000_000)),
          dailyCap: Number(draft.dailyCap),
          allowedAgents: draft.agents.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean),
          live: draft.live,
          facts: chosen.map((i) => ({
            memoryRef: i.memory.ref,
            text: i.memory.text,
            type: i.memory.header.type,
            sources: i.memory.header.sources,
            heardAt: i.memory.header.at,
          })),
        }),
      });
      if (response.status === 401 || response.status === 403) throw new Error('Ferry Gate needs you to sign in with your wallet first.');
      if (!response.ok) throw new Error(`Ferry Gate returned ${response.status}. Nothing was published.`);
      toast.show({ message: draft.live ? 'Share Card saved. It is live.' : 'Share Card saved. It is off until you turn it on.' });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not reach Ferry Gate. Nothing was published.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="card-editor" className="flex flex-col gap-5 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1">
      <div className="flex items-center justify-between gap-3">
        <h2 id="card-editor" className="text-title font-semibold text-text-primary">
          Share Card
        </h2>
        <Toggle
          label={draft.live ? 'Card is live' : 'Card is off'}
          checked={draft.live}
          onCheckedChange={(live) => setDraft({ ...draft, live })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" placeholder="Food preferences" value={draft.name} error={errors.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
        <Input label="Scope label" placeholder="food, travel" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} maxLength={40} />
        <Input
          label="Price per recall"
          inputMode="decimal"
          suffix="USDC"
          value={draft.price}
          error={errors.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
        />
        <Input
          label="Daily cap"
          inputMode="numeric"
          suffix="recalls"
          value={draft.dailyCap}
          error={errors.dailyCap}
          onChange={(e) => setDraft({ ...draft, dailyCap: e.target.value })}
        />
      </div>
      <Textarea
        label="Allowed agents (optional)"
        helper="One Sui address per line. Leave empty to let any agent pay."
        placeholder="0x4a1c...9e02"
        value={draft.agents}
        error={errors.agents}
        onChange={(e) => setDraft({ ...draft, agents: e.target.value })}
        className="min-h-20 font-mono text-[0.8125rem]"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-small font-medium text-text-secondary">Facts on this card</legend>
        {!ready ? (
          <p className="text-body text-text-secondary">Open and pair Ferry in this browser to pick facts from your memory.</p>
        ) : facts.status === 'loading' ? (
          <LoadingText>Reading your memory through the extension</LoadingText>
        ) : facts.status === 'error' ? (
          <p className="text-small text-danger">{facts.error.message}</p>
        ) : items.length === 0 ? (
          <p className="text-body text-text-secondary">No active facts yet. Rescue an export first, then come back.</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-sm border border-border-hairline p-1">
            {items.map((i) => {
              const checked = draft.refs.includes(i.memory.ref);
              return (
                <li key={i.memory.ref}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraft({ ...draft, refs: checked ? draft.refs.filter((r) => r !== i.memory.ref) : [...draft.refs, i.memory.ref] })
                      }
                      className="size-4 shrink-0 accent-[var(--ferry-accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-body text-text-primary">{i.memory.text}</span>
                    <span className="shrink-0 text-small text-text-tertiary">{FACT_TYPE_LABEL[i.memory.header.type]}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {errors.refs ? <p className="text-small text-danger">{errors.refs}</p> : null}
      </fieldset>
      <p className="text-small text-text-tertiary">Gate can only read your Public profile account. Saving copies the chosen facts there.</p>
      {saveError ? (
        <p role="alert" className="text-small text-danger">
          {saveError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Contact} loading={saving} loadingLabel="Saving card" disabled={!owner || !gateConfigured()} onClick={() => void save()}>
          Save Share Card
        </Button>
        {!gateConfigured() ? <span className="text-small text-text-tertiary">Ferry Gate is not configured on this deployment.</span> : null}
        {gateConfigured() && !owner ? <span className="text-small text-text-tertiary">Connect your wallet to save.</span> : null}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

function useEarnings(owner: string | null) {
  const toast = useToast();
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!owner || !gateConfigured()) return;
    let active = true;
    const load = async () => {
      try {
        const next = await getEarnings(owner);
        if (!active) return;
        const known = seen.current;
        if (known) {
          for (const p of next.payments) {
            if (!known.has(p.receiptId)) toast.show({ message: `Received ${formatUsdc(p.amountMicros)} USDC from ${p.payer.slice(0, 6)}...${p.payer.slice(-4)}` });
          }
        }
        seen.current = new Set(next.payments.map((p) => p.receiptId));
        setData(next);
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not reach Ferry Gate.');
      }
    };
    void load();
    // Tatum has no Sui webhooks (RESEARCH 2.6), so new payments are polled.
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [owner, nonce, toast]);

  return { data, error, reload: () => setNonce((n) => n + 1) };
}

function EarningsSummary({ earnings, error, onRetry }: { earnings: Earnings | null; error: string | null; onRetry: () => void }) {
  const usd = earnings?.usdRate ? (Number(earnings.totalMicros) / 1e6) * earnings.usdRate.value : null;
  return (
    <section aria-labelledby="earnings-total" className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1">
      <h2 id="earnings-total" className="text-title font-semibold text-text-primary">
        Earnings
      </h2>
      {error && !earnings ? (
        <Notice tone="danger" live action={<Button size="sm" icon={RotateCw} onClick={onRetry}>Retry</Button>}>
          {error}
        </Notice>
      ) : !earnings ? (
        <LoadingText>Reading payments from Ferry Gate</LoadingText>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <Counter value={Number(earnings.totalMicros) / 1e6} format={(n) => n.toFixed(2)} className="text-display-lg font-semibold tracking-[-0.03em] text-text-primary" live />
            <span className="text-title text-text-secondary">USDC</span>
          </p>
          <p className="text-small text-text-tertiary">
            {usd !== null && earnings.usdRate
              ? `About $${usd.toFixed(2)} from Tatum price data as of ${formatTime(earnings.usdRate.asOf)}.`
              : 'Fiat value appears once Tatum price data is available.'}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-4 border-t border-border-hairline pt-4">
            <div>
              <dt className="text-small text-text-secondary">Today</dt>
              <dd className="tabular text-body font-medium text-text-primary">{formatUsdc(earnings.todayMicros)} USDC</dd>
            </div>
            <div>
              <dt className="text-small text-text-secondary">Paid recalls</dt>
              <dd className="tabular text-body font-medium text-text-primary">{earnings.count.toLocaleString('en-US')}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function EarningsTable({ earnings }: { earnings: Earnings }) {
  const reduce = useReducedMotion();
  if (earnings.payments.length === 0) {
    return (
      <EmptyState icon={HandCoins} title="No paid recalls yet">
        No paid recalls yet. Run the TripScout example below to see one arrive.
      </EmptyState>
    );
  }
  return (
    <DataTable caption="Paid recalls of your Share Cards">
      <DataHead
        columns={[{ label: 'Time' }, { label: 'Agent' }, { label: 'Query' }, { label: 'Amount', align: 'right' }, { label: 'Transaction' }]}
      />
      <tbody>
        <AnimatePresence initial={false}>
          {earnings.payments.map((p) => (
            <motion.tr
              key={p.receiptId}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.card}
              className="h-11 border-b border-border-hairline last:border-b-0"
            >
              <DataCell className="tabular whitespace-nowrap text-text-secondary">{formatDateTime(p.createdAtMs)}</DataCell>
              <DataCell>
                <MonoId value={p.payer} kind="Agent address" href={explorer.account(p.payer)} />
              </DataCell>
              <DataCell>
                <span tabIndex={0} title={`Query hash ${p.querySha256}`} className="font-mono text-[0.8125rem] text-text-secondary">
                  {`${p.querySha256.slice(0, 10)}...`}
                  <span className="sr-only">{`Query hash ${p.querySha256}`}</span>
                </span>
              </DataCell>
              <DataCell align="right" className="whitespace-nowrap">{`${formatUsdc(p.amountMicros)} USDC`}</DataCell>
              <DataCell>
                <span className="inline-flex items-center gap-2">
                  <MonoId value={p.digest} kind="Transaction digest" href={explorer.tx(p.digest)} hrefLabel="Open transaction in Sui explorer" />
                  <span className="inline-flex items-center gap-1 text-small text-success">
                    <VerifyCheck state="static" size={20} />
                    Verified through Tatum
                  </span>
                </span>
              </DataCell>
            </motion.tr>
          ))}
        </AnimatePresence>
      </tbody>
    </DataTable>
  );
}

export function ShareView() {
  const wallet = useCurrentAccount();
  const owner = wallet?.address ?? null;
  const earnings = useEarnings(owner);
  const code = useMemo(() => TRIPSCOUT, []);
  return (
    <>
      <PageHeader title="Share and Earn">
        Publish a small set of facts as a Share Card. Agents pay you per recall, in USDC on Sui, and see only what is on the card.
      </PageHeader>
      <Explainer />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <CardEditor owner={owner} />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          {owner ? (
            gateConfigured() ? (
              <EarningsSummary earnings={earnings.data} error={earnings.error} onRetry={earnings.reload} />
            ) : (
              <Notice tone="warning">Ferry Gate is not configured on this deployment, so earnings cannot be read.</Notice>
            )
          ) : (
            <section className="flex flex-col gap-4 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1">
              <h2 className="text-title font-semibold text-text-primary">Earnings</h2>
              <p className="text-body text-text-secondary">Connect the wallet that receives payments to see what agents paid you.</p>
              <WalletPicker />
            </section>
          )}
        </div>
      </div>
      {earnings.data ? (
        <section aria-labelledby="earnings-table" className="mt-8 flex flex-col gap-4">
          <h2 id="earnings-table" className="text-title font-semibold text-text-primary">
            Paid recalls
          </h2>
          {earnings.error ? <Notice tone="warning">{`Showing the last good read. ${earnings.error}`}</Notice> : null}
          <EarningsTable earnings={earnings.data} />
        </section>
      ) : null}
      <section aria-labelledby="sdk-sample" className="mt-10 flex flex-col gap-4">
        <h2 id="sdk-sample" className="text-title font-semibold text-text-primary">
          Try it with an agent
        </h2>
        <p className="max-w-[68ch] text-body text-text-secondary">
          TripScout is a 15 line agent built on @ferry/sdk. It asks your card for food preferences, gets a 402 from Gate, pays 0.01 USDC
          on Sui Mainnet, and prints the facts with the transaction link.
        </p>
        <CodeBlock title="examples/tripscout/index.ts" code={code} />
      </section>
    </>
  );
}
