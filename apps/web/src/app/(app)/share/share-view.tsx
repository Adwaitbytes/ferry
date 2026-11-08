'use client';

import type { GateEarnings, GateOwnerCard, GateProfile, GateSession, MemoryRef, PublishableFact } from '@ferry/core';
import {
  Button,
  CodeBlock,
  Counter,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
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
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Contact, Download, HandCoins, LogIn, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useExtension } from '@/components/extension-context';
import { WalletPicker } from '@/components/wallet';
import { bridge, type LibraryItem } from '@/lib/bridge';
import { FACT_TYPE_LABEL, formatDateTime } from '@/lib/format';
import {
  GateError,
  createCard,
  gateConfigured,
  getEarnings,
  getGateProfile,
  killCard,
  listCards,
  setCardEnabled,
  signInToGate,
} from '@/lib/gate';
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

const PUBLISH_FILE = 'ferry-public-facts.json';
const PUBLISH_COMMAND = `pnpm publish-public ${PUBLISH_FILE}`;
const EXPLAINER_KEY = 'ferry-share-explainer-dismissed';
const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
/** Up to 6 whole digits and 6 decimals (USDC has 6). Split instead of one regex to keep it linear. */
function isPrice(value: string): boolean {
  const [whole, frac, extra] = value.split('.');
  return extra === undefined && /^\d{1,6}$/.test(whole ?? '') && (frac === undefined || /^\d{1,6}$/.test(frac));
}

/** Decimal USDC to integer micros without floats: "0.01" is exactly 10000. */
function toMicros(price: string): string {
  const [whole = '0', frac = ''] = price.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))).toString();
}

const sameAddress = (a: string, b: string) => normalizeSuiAddress(a) === normalizeSuiAddress(b);

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
/* Session                                                            */
/* ---------------------------------------------------------------- */

/** The SIWS session lives in memory only; a different wallet or a reload means signing in again. */
function useGateSession(address: string | null) {
  const dAppKit = useDAppKit();
  const [session, setSession] = useState<GateSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession((s) => (s && address && sameAddress(s.address, address) ? s : null));
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const next = await signInToGate(
        address,
        async (message) => ({ signature: (await dAppKit.signPersonalMessage({ message })).signature }),
        window.location.host,
      );
      setSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed. Nothing was signed.');
    } finally {
      setBusy(false);
    }
  }, [address, dAppKit]);

  const live = session !== null && Date.parse(session.expiresAt) > Date.now() ? session : null;
  return { session: live, busy, error, signIn, expire: () => setSession(null) };
}

function SignInPanel({ busy, error, onSignIn }: { busy: boolean; error: string | null; onSignIn: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-text-secondary">
        Sign a short message with your wallet to manage cards and read earnings. It is not a transaction and costs nothing.
      </p>
      <div>
        <Button variant="primary" icon={LogIn} loading={busy} loadingLabel="Waiting for your wallet" onClick={onSignIn}>
          Sign in to Ferry Gate
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Cards                                                              */
/* ---------------------------------------------------------------- */

interface CardDraft {
  name: string;
  scope: string;
  price: string;
  dailyCap: string;
  agents: string;
}

const EMPTY_DRAFT: CardDraft = { name: '', scope: '', price: '0.01', dailyCap: '100', agents: '' };

function validate(draft: CardDraft): Partial<Record<keyof CardDraft, string>> {
  const errors: Partial<Record<keyof CardDraft, string>> = {};
  if (!draft.name.trim()) errors.name = 'Give the card a name, for example Food preferences.';
  if (!draft.scope.trim()) errors.scope = 'Say what agents get, for example food, travel.';
  if (!isPrice(draft.price) || toMicros(draft.price) === '0') errors.price = 'Enter a price above 0, with up to 6 decimals, for example 0.01.';
  if (!/^\d{1,6}$/.test(draft.dailyCap) || Number(draft.dailyCap) < 1) errors.dailyCap = 'Enter a whole number of recalls per day, 1 or more.';
  const lines = draft.agents
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bad = lines.filter((l) => !ADDRESS_RE.test(l));
  if (bad.length > 0) errors.agents = `${bad.length === 1 ? 'This line is' : 'These lines are'} not a Sui address: ${bad.slice(0, 2).join(', ')}`;
  else if (lines.length > 20) errors.agents = 'Up to 20 agents per card.';
  return errors;
}

function CardEditor({ token, onCreated }: { token: string; onCreated: (card: GateOwnerCard) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const errors = touched ? validate(draft) : {};

  const save = async () => {
    setTouched(true);
    if (Object.keys(validate(draft)).length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const card = await createCard(token, {
        name: draft.name.trim(),
        scopeLabel: draft.scope.trim(),
        priceMicros: toMicros(draft.price),
        dailyCap: Number(draft.dailyCap),
        allowedAgents: draft.agents
          .split('\n')
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean),
      });
      onCreated(card);
      setDraft(EMPTY_DRAFT);
      setTouched(false);
      toast.show({ message: `Share Card created. Card id ${card.id}.` });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not reach Ferry Gate. No card was created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" placeholder="Food preferences" value={draft.name} error={errors.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} />
        <Input label="Scope label" placeholder="food, travel" value={draft.scope} error={errors.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} maxLength={40} />
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
      <p className="text-small text-text-tertiary">Every card serves the facts published to your Public profile account. Cards differ by price, cap and agents.</p>
      {saveError ? (
        <p role="alert" className="text-small text-danger">
          {saveError}
        </p>
      ) : null}
      <div>
        <Button variant="primary" icon={Contact} loading={saving} loadingLabel="Creating card" onClick={() => void save()}>
          Create Share Card
        </Button>
      </div>
    </div>
  );
}

function CardRow({ card, token, onChange }: { card: GateOwnerCard; token: string; onChange: (card: GateOwnerCard | null) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await setCardEnabled(token, card.id, enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the card.');
    } finally {
      setBusy(false);
    }
  };

  const kill = async () => {
    setBusy(true);
    setError(null);
    try {
      await killCard(token, card.id);
      setConfirmKill(false);
      onChange(null);
      toast.show({ message: `${card.name} is killed. Agents now get not found.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not kill the card.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 border-b border-border-hairline py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-body font-medium text-text-primary">{card.name}</span>
          <span className="text-small text-text-secondary">
            {`${card.scopeLabel} · ${card.price} USDC per recall · ${card.dailyCap.toLocaleString('en-US')} per day`}
          </span>
          <MonoId value={card.id} kind="Card id" />
        </div>
        <Toggle
          label={card.enabled ? 'Live' : 'Off'}
          checked={card.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmKill(true)}>
          Kill card
        </Button>
        {error ? (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Dialog
        open={confirmKill}
        onOpenChange={setConfirmKill}
        title={`Kill ${card.name}?`}
        description="Agents get not found from then on. A killed card cannot be turned back on; create a new one instead."
        footer={
          <>
            <Button onClick={() => setConfirmKill(false)}>Keep card</Button>
            <Button variant="danger" loading={busy} loadingLabel="Killing card" onClick={() => void kill()}>
              Kill card
            </Button>
          </>
        }
      />
    </li>
  );
}

function CardsPanel({ session, profile }: { session: GateSession; profile: GateProfile }) {
  const [cards, setCards] = useState<GateOwnerCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = sameAddress(session.address, profile.owner);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCards((await listCards(session.token)).cards.filter((c) => !c.killed));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your cards.');
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      {isOwner ? (
        <CardEditor token={session.token} onCreated={(card) => setCards((prev) => [card, ...(prev ?? [])])} />
      ) : (
        <Notice tone="warning" title="This wallet cannot create cards">
          Only the wallet that owns the Public profile account can sell its facts. That wallet is{' '}
          <MonoId value={profile.owner} kind="Public profile owner" href={explorer.account(profile.owner)} />. Connect it and sign in again.
        </Notice>
      )}
      <section aria-labelledby="your-cards" className="flex flex-col gap-2">
        <h3 id="your-cards" className="text-body font-semibold text-text-primary">
          Your cards
        </h3>
        {error ? (
          <Notice tone="danger" live action={<Button size="sm" icon={RotateCw} onClick={() => void load()}>Retry</Button>}>
            {error}
          </Notice>
        ) : cards === null ? (
          <LoadingText>Reading your cards from Ferry Gate</LoadingText>
        ) : cards.length === 0 ? (
          <p className="text-body text-text-secondary">No cards yet.</p>
        ) : (
          <ul className="flex flex-col">
            {cards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                token={session.token}
                onChange={(next) => setCards((prev) => (prev ?? []).flatMap((c) => (c.id !== card.id ? [c] : next ? [next] : [])))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Publishing                                                         */
/* ---------------------------------------------------------------- */

function toPublishable(item: LibraryItem): PublishableFact {
  return { text: item.memory.text, type: item.memory.header.type, sources: item.memory.header.sources, heardAt: item.memory.header.at };
}

/**
 * Publishing writes to a different account with a different delegate key (the Gate's), which this
 * browser does not hold. So the page exports exactly what the user approved, and the CLI writes it.
 */
function PublishPanel() {
  const { state } = useExtension();
  const ready = state.kind === 'ready' && state.status.paired && !state.status.locked;
  const facts = useResource(ready ? () => bridge({ type: 'memory.list', status: 'active' }) : null, ready ? 'share-facts' : 'off');
  const [refs, setRefs] = useState<MemoryRef[]>([]);
  const items: LibraryItem[] = facts.status === 'ready' ? facts.data.items.filter((i) => i.memory.status === 'active') : [];
  const chosen = items.filter((i) => refs.includes(i.memory.ref));

  return (
    <section aria-labelledby="publish" className="flex flex-col gap-4 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1">
      <h2 id="publish" className="text-title font-semibold text-text-primary">
        Publish facts
      </h2>
      <p className="text-body text-text-secondary">
        Pick the facts agents may buy. Ferry downloads them as a file, and you publish it from your machine with the Public profile key.
        Conversation and quote hashes are replaced with a constant before anything is written.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-small font-medium text-text-secondary">Facts from your memory</legend>
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
              const checked = refs.includes(i.memory.ref);
              return (
                <li key={i.memory.ref}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setRefs(checked ? refs.filter((r) => r !== i.memory.ref) : [...refs, i.memory.ref])}
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
      </fieldset>
      <div>
        <Button
          icon={Download}
          disabled={chosen.length === 0}
          onClick={() => download(PUBLISH_FILE, 'application/json', JSON.stringify(chosen.map(toPublishable), null, 2))}
        >
          {chosen.length === 0 ? 'Download approved facts' : `Download ${chosen.length} approved ${chosen.length === 1 ? 'fact' : 'facts'}`}
        </Button>
      </div>
      <CodeBlock title="Then, from the Ferry repo" code={PUBLISH_COMMAND} />
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Earnings                                                           */
/* ---------------------------------------------------------------- */

function useEarnings(session: GateSession | null, onExpired: () => void) {
  const toast = useToast();
  const [data, setData] = useState<GateEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!session) {
      setData(null);
      seen.current = null;
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const next = await getEarnings(session.address, session.token);
        if (!active) return;
        const known = seen.current;
        if (known) {
          for (const p of next.payments) {
            if (!known.has(p.receiptId)) toast.show({ message: `Received ${p.amount} USDC from ${p.agent.slice(0, 6)}...${p.agent.slice(-4)}` });
          }
        }
        seen.current = new Set(next.payments.map((p) => p.receiptId));
        setData(next);
        setError(null);
      } catch (e) {
        if (!active) return;
        if (e instanceof GateError && e.status === 401) onExpired();
        setError(e instanceof Error ? e.message : 'Could not reach Ferry Gate.');
      }
    };
    void load();
    // Tatum has no Sui webhooks (RESEARCH 2.6), so new payments are polled.
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, nonce, toast, onExpired]);

  return { data, error, reload: () => setNonce((n) => n + 1) };
}

function EarningsSummary({ earnings, error, onRetry }: { earnings: GateEarnings | null; error: string | null; onRetry: () => void }) {
  return (
    <>
      {error && !earnings ? (
        <Notice tone="danger" live action={<Button size="sm" icon={RotateCw} onClick={onRetry}>Retry</Button>}>
          {error}
        </Notice>
      ) : !earnings ? (
        <LoadingText>Reading payments from Ferry Gate</LoadingText>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <Counter value={Number(earnings.totals.total)} format={(n) => n.toFixed(2)} className="text-display-lg font-semibold tracking-[-0.03em] text-text-primary" live />
            <span className="text-title text-text-secondary">USDC</span>
          </p>
          <p className="text-small text-text-tertiary">
            {earnings.totals.totalUsd !== null
              ? `About $${earnings.totals.totalUsd} at ${earnings.totals.usdcUsd ?? ''} USD per USDC, from Tatum price data.`
              : 'Fiat value appears once Tatum price data is available.'}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-4 border-t border-border-hairline pt-4">
            <div>
              <dt className="text-small text-text-secondary">Today</dt>
              <dd className="tabular text-body font-medium text-text-primary">{earnings.totals.today} USDC</dd>
            </div>
            <div>
              <dt className="text-small text-text-secondary">Paid recalls</dt>
              <dd className="tabular text-body font-medium text-text-primary">{earnings.totals.count.toLocaleString('en-US')}</dd>
            </div>
          </dl>
        </>
      )}
    </>
  );
}

function EarningsTable({ earnings }: { earnings: GateEarnings }) {
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
        columns={[{ label: 'Time' }, { label: 'Card' }, { label: 'Agent' }, { label: 'Query' }, { label: 'Amount', align: 'right' }, { label: 'Transaction' }]}
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
              <DataCell className="tabular whitespace-nowrap text-text-secondary">{formatDateTime(p.createdAt)}</DataCell>
              <DataCell className="whitespace-nowrap">{p.cardName}</DataCell>
              <DataCell>
                <MonoId value={p.agent} kind="Agent address" href={explorer.account(p.agent)} />
              </DataCell>
              <DataCell>
                <span tabIndex={0} title={`Query hash ${p.querySha256}`} className="font-mono text-[0.8125rem] text-text-secondary">
                  {`${p.querySha256.slice(0, 10)}...`}
                  <span className="sr-only">{`Query hash ${p.querySha256}`}</span>
                </span>
              </DataCell>
              <DataCell align="right" className="whitespace-nowrap">{`${p.amount} USDC`}</DataCell>
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

/* ---------------------------------------------------------------- */

function GatePanels() {
  const wallet = useCurrentAccount();
  const address = wallet?.address ?? null;
  const gate = useGateSession(address);
  const { expire } = gate;
  const onExpired = useCallback(() => expire(), [expire]);
  const earnings = useEarnings(gate.session, onExpired);
  const profile = useResource(getGateProfile, 'gate-profile');

  const signInOrWallet = !address ? (
    <>
      <p className="text-body text-text-secondary">Connect the wallet that owns your Public profile account.</p>
      <WalletPicker />
    </>
  ) : (
    <SignInPanel busy={gate.busy} error={gate.error} onSignIn={() => void gate.signIn()} />
  );

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-12">
        <section aria-labelledby="cards" className="flex flex-col gap-5 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1 lg:col-span-7">
          <h2 id="cards" className="text-title font-semibold text-text-primary">
            Share Cards
          </h2>
          {profile.status === 'error' ? (
            <Notice tone="danger" live action={<Button size="sm" icon={RotateCw} onClick={profile.reload}>Retry</Button>}>
              {profile.error.message}
            </Notice>
          ) : profile.status === 'loading' ? (
            <LoadingText>Asking Ferry Gate who owns the Public profile account</LoadingText>
          ) : !gate.session ? (
            signInOrWallet
          ) : (
            <CardsPanel session={gate.session} profile={profile.data} />
          )}
        </section>
        <section aria-labelledby="earnings-total" className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1 lg:col-span-5">
          <h2 id="earnings-total" className="text-title font-semibold text-text-primary">
            Earnings
          </h2>
          {gate.session ? (
            <EarningsSummary earnings={earnings.data} error={earnings.error} onRetry={earnings.reload} />
          ) : (
            <p className="text-body text-text-secondary">Sign in with the wallet that receives payments to see what agents paid you.</p>
          )}
        </section>
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
    </>
  );
}

export function ShareView() {
  const code = useMemo(() => TRIPSCOUT, []);
  return (
    <>
      <PageHeader title="Share and Earn">
        Publish a small set of facts to your Public profile account. Agents pay you per recall, in USDC on Sui, and see only what you
        published there.
      </PageHeader>
      <Explainer />
      {gateConfigured() ? (
        <GatePanels />
      ) : (
        <Notice tone="warning">Ferry Gate is not configured on this deployment, so cards and earnings are unavailable.</Notice>
      )}
      <div className="mt-8">
        <PublishPanel />
      </div>
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
