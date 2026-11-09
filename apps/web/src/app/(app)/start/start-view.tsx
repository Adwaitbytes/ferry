'use client';

import { buildAddDelegateKeyTx, buildCreateAccountTx } from '@ferry/chain/tx';
import { SponsorUnavailableError, sponsoredExecute } from '@/lib/sponsor';
import { keyFingerprint, type AccountView } from '@ferry/core';
import { Button, cn, IndeterminateProgress, MonoId, Notice, VerifyCheck } from '@ferry/ui';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { ArrowUpRight, Check, KeyRound, LifeBuoy, RotateCw, TextCursorInput, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useExtension } from '@/components/extension-context';
import { NotInstalled } from '@/components/extension-gate';
import { ConnectedWallet, WalletPicker, hexToBytes } from '@/components/wallet';
import { getAccountByOwner } from '@/lib/api';
import { BridgeError, bridge, type PairingOffer } from '@/lib/bridge';
import { browserName, formatDate } from '@/lib/format';
import { explorer, walrusSources } from '@/lib/links';

const STEPS = ['Connect wallet', 'Memory account', 'Pair this browser', 'First move'] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-10 grid grid-cols-4 gap-2" aria-label="Setup steps">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex flex-col gap-2">
            <span className={cn('h-0.5 rounded-full', done || active ? 'bg-accent' : 'bg-surface-3')} aria-hidden="true" />
            <span className={cn('flex items-center gap-1.5 text-small', active ? 'font-medium text-text-primary' : 'text-text-tertiary')}>
              {done ? <Check size={14} strokeWidth={2} className="text-accent" aria-hidden="true" /> : <span className="tabular">{index + 1}</span>}
              <span className="hidden sm:inline">{label}</span>
              <span className="sr-only">{done ? ', done' : active ? ', current step' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="step-title" className="flex flex-col gap-5">
      <h2 id="step-title" className="ferry-display-md text-display-md text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- */

type AccountState =
  | { kind: 'detecting' }
  | { kind: 'found'; account: AccountView }
  | { kind: 'missing' }
  | { kind: 'creating' }
  | { kind: 'waiting' }
  | { kind: 'error'; message: string };

function useOwnerAccount(owner: string | null) {
  const [state, setState] = useState<AccountState>({ kind: 'detecting' });
  const detect = useCallback(async () => {
    if (!owner) return;
    setState({ kind: 'detecting' });
    try {
      const account = await getAccountByOwner(owner);
      setState(account ? { kind: 'found', account } : { kind: 'missing' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Tatum did not answer.' });
    }
  }, [owner]);
  useEffect(() => {
    void detect();
  }, [detect]);
  return { state, setState, detect };
}

function AccountStep({ owner, account }: { owner: string; account: ReturnType<typeof useOwnerAccount> }) {
  const dAppKit = useDAppKit();
  const { state, setState } = account;

  const create = async () => {
    setState({ kind: 'creating' });
    try {
      // Relayer-sponsored gas first, so a wallet with no SUI can still create its account.
      // Any sponsorship failure (relayer limit, network, declined authorization) falls back to gas
      // paid by the wallet; a rejection there is the user's final answer.
      await sponsoredExecute(dAppKit, owner, buildCreateAccountTx()).catch(async () => {
        const result = await dAppKit.signAndExecuteTransaction({ transaction: buildCreateAccountTx() });
        if (result.FailedTransaction) throw new Error('failed on chain');
      });
    } catch {
      setState({ kind: 'error', message: 'Account creation failed: the transaction was rejected. Nothing was charged. Try again.' });
      return;
    }
    setState({ kind: 'waiting' });
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(2000);
      try {
        const found = await getAccountByOwner(owner);
        if (found) {
          setState({ kind: 'found', account: found });
          return;
        }
      } catch {
        // A transient Tatum error during the wait is retried on the next tick.
      }
    }
    setState({ kind: 'error', message: 'The account was created, but Tatum does not show it yet. Check again in a few seconds.' });
  };

  return (
    <Step title="Your memory account">
      {state.kind === 'detecting' ? <IndeterminateProgress label="Looking for your Walrus Memory account through Tatum" /> : null}
      {state.kind === 'missing' || state.kind === 'creating' ? (
        <>
          <p className="text-body-lg text-text-secondary">
            You do not have a Walrus Memory account yet. Creating one is one transaction on Sui Mainnet.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary" size="lg" loading={state.kind === 'creating'} loadingLabel="Waiting for your wallet" onClick={() => void create()}>
              Create memory account
            </Button>
            <a
              href={walrusSources.memoryApp}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-body text-accent underline-offset-[3px] hover:underline"
            >
              Create it on memory.walrus.xyz instead
              <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </div>
        </>
      ) : null}
      {state.kind === 'waiting' ? <IndeterminateProgress label="Confirming your new account on Sui through Tatum" /> : null}
      {state.kind === 'error' ? (
        <Notice
          tone="danger"
          live
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void account.detect()}>
              Check again
            </Button>
          }
        >
          {state.message}
        </Notice>
      ) : null}
    </Step>
  );
}

/* ---------------------------------------------------------------- */

type PairState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'ready'; offer: PairingOffer; mismatch: boolean }
  | { kind: 'signing'; offer: PairingOffer }
  | { kind: 'confirming'; offer: PairingOffer }
  | { kind: 'unconfirmed'; offer: PairingOffer }
  | { kind: 'paired' }
  | { kind: 'error'; message: string };

function PairStep({ account, onPaired }: { account: AccountView; onPaired: () => void }) {
  const dAppKit = useDAppKit();
  const { state: ext, refresh } = useExtension();
  const [state, setState] = useState<PairState>({ kind: 'idle' });
  const [label] = useState(() => `Ferry on ${browserName(navigator.userAgent)} ${formatDate(Date.now())}`);

  const prepare = useCallback(async () => {
    setState({ kind: 'preparing' });
    try {
      const offer = await bridge({ type: 'pairing.begin' });
      const local = keyFingerprint(offer.publicKeyHex);
      setState({ kind: 'ready', offer, mismatch: local !== offer.fingerprint.toLowerCase() });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Ferry did not answer.' });
    }
  }, []);

  const ready = ext.kind === 'ready' && !ext.status.locked;
  useEffect(() => {
    if (ready && state.kind === 'idle') void prepare();
  }, [ready, state.kind, prepare]);

  const confirm = async (offer: PairingOffer) => {
    setState({ kind: 'confirming', offer });
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await bridge({ type: 'pairing.confirm', accountId: account.accountId }, { timeoutMs: 20_000 });
        setState({ kind: 'paired' });
        await refresh();
        return;
      } catch (error) {
        if (!(error instanceof BridgeError) || error.kind === 'locked' || error.kind === 'not_installed') {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Ferry did not answer.' });
          return;
        }
        await sleep(2000);
      }
    }
    setState({ kind: 'unconfirmed', offer });
  };

  const pair = async (offer: PairingOffer) => {
    setState({ kind: 'signing', offer });
    try {
      const build = () => buildAddDelegateKeyTx({ accountId: account.accountId, publicKey32: hexToBytes(offer.publicKeyHex), label });
      const sender = dAppKit.stores.$connection.get().account?.address;
      let rejected: string | null = null;
      await (sender ? sponsoredExecute(dAppKit, sender, build()) : Promise.reject(new SponsorUnavailableError('no sender'))).catch(async () => {
        const result = await dAppKit.signAndExecuteTransaction({ transaction: build() });
        if (result.FailedTransaction) rejected = result.FailedTransaction.status.error?.message ?? 'no reason given';
      });
      if (rejected) {
        setState({ kind: 'error', message: `Sui rejected the key: ${rejected}.` });
        return;
      }
    } catch {
      setState({ kind: 'ready', offer, mismatch: false });
      return;
    }
    await confirm(offer);
  };

  if (ext.kind === 'not_installed') return <NotInstalled onRetry={() => void refresh()} />;
  if (ext.kind === 'ready' && ext.status.locked) {
    return (
      <Step title="Open Ferry first">
        <p className="text-body-lg text-text-secondary">
          Ferry is locked. Open the side panel with Alt F, enter your passphrase, then come back. If this is a new install, the
          side panel asks you to create a passphrase that protects this browser&rsquo;s key.
        </p>
        <Button icon={RotateCw} onClick={() => void refresh()}>
          Check again
        </Button>
      </Step>
    );
  }

  return (
    <Step title="Pair this browser">
      <p className="text-body-lg text-text-secondary">
        Ferry will add a key for this browser to your account. The key stays inside the extension. One signature.
      </p>
      {state.kind === 'idle' || state.kind === 'preparing' ? <IndeterminateProgress label="Asking the extension for this browser's key" /> : null}
      {'offer' in state ? (
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 rounded-md border border-border-hairline bg-surface-1 p-5 text-small">
          <dt className="text-text-secondary">Label</dt>
          <dd className="font-mono text-[0.8125rem] text-text-primary">{label}</dd>
          <dt className="text-text-secondary">Fingerprint</dt>
          <dd className="font-mono text-[0.8125rem] tracking-[0.04em] text-text-primary">{state.offer.fingerprint}</dd>
          <dt className="text-text-secondary">Account</dt>
          <dd>
            <MonoId value={account.accountId} kind="Account object id" href={explorer.object(account.accountId)} />
          </dd>
        </dl>
      ) : null}
      {'offer' in state ? (
        <p className="text-small text-text-tertiary">Check that the fingerprint matches the one in the Ferry side panel before you sign.</p>
      ) : null}
      {state.kind === 'ready' && state.mismatch ? (
        <Notice tone="danger" live>
          The fingerprint the extension shows does not match its key. Do not sign. Reload the extension and try again.
        </Notice>
      ) : null}
      {state.kind === 'ready' || state.kind === 'signing' ? (
        <Button
          variant="primary"
          size="lg"
          icon={KeyRound}
          className="self-start"
          disabled={state.kind === 'ready' && state.mismatch}
          loading={state.kind === 'signing'}
          loadingLabel="Waiting for your wallet"
          onClick={() => void pair(state.offer)}
        >
          Pair this browser
        </Button>
      ) : null}
      {state.kind === 'confirming' ? <IndeterminateProgress label="Confirming the key on Sui" /> : null}
      {state.kind === 'unconfirmed' ? (
        <Notice
          tone="warning"
          live
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void confirm(state.offer)}>
              Retry
            </Button>
          }
        >
          We could not see the new key on Sui yet. This can take a few seconds.
        </Notice>
      ) : null}
      {state.kind === 'paired' ? (
        <div role="status" className="flex items-center gap-3">
          <VerifyCheck state="verified" size={32} />
          <p className="text-body-lg text-text-primary">Paired. This browser can read and write your memory.</p>
        </div>
      ) : null}
      {state.kind === 'paired' ? (
        <Button variant="primary" className="self-start" onClick={onPaired}>
          Continue
        </Button>
      ) : null}
      {state.kind === 'error' ? (
        <Notice
          tone="danger"
          live
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void prepare()}>
              Try again
            </Button>
          }
        >
          {state.message}
        </Notice>
      ) : null}
    </Step>
  );
}

/* ---------------------------------------------------------------- */

function ChoiceCard({
  value,
  checked,
  onSelect,
  icon: Icon,
  title,
  body,
}: {
  value: string;
  checked: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-4 rounded-md border bg-surface-1 p-5 transition-[border-color,box-shadow] duration-150 ease-out has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring',
        checked ? 'border-accent shadow-2' : 'border-border-hairline hover:border-border-strong',
      )}
    >
      <input type="radio" name="first-move" value={value} checked={checked} onChange={onSelect} className="sr-only" />
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md', checked ? 'bg-accent-subtle text-accent' : 'bg-surface-3 text-text-secondary')}>
        <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-title font-semibold text-text-primary">{title}</span>
        <span className="text-body text-text-secondary">{body}</span>
      </span>
    </label>
  );
}

function FirstMoveStep() {
  const router = useRouter();
  const [choice, setChoice] = useState<'rescue' | 'carry'>('rescue');
  return (
    <Step title="What first?">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Choose your first move</legend>
        <ChoiceCard
          value="rescue"
          checked={choice === 'rescue'}
          onSelect={() => setChoice('rescue')}
          icon={LifeBuoy}
          title="Rescue what your AIs know"
          body="Import ChatGPT, Claude or Gemini exports. About 3 minutes."
        />
        <ChoiceCard
          value="carry"
          checked={choice === 'carry'}
          onSelect={() => setChoice('carry')}
          icon={TextCursorInput}
          title="Start carrying"
          body="Open any chat. Ferry offers context when it helps."
        />
      </fieldset>
      <Button variant="primary" size="lg" className="self-start" onClick={() => router.push(choice === 'rescue' ? '/rescue' : '/library')}>
        Continue
      </Button>
    </Step>
  );
}

/* ---------------------------------------------------------------- */

export function StartView() {
  const wallet = useCurrentAccount();
  const { state: ext } = useExtension();
  const owner = wallet?.address ?? null;
  const account = useOwnerAccount(owner);
  const [pairedNow, setPairedNow] = useState(false);
  // Once pairing starts on this page, stay on the pair step until the user continues, so the
  // "Paired." confirmation is seen instead of being replaced by the already-paired branch.
  const [pairingHere, setPairingHere] = useState(false);

  const alreadyPaired = ext.kind === 'ready' && ext.status.paired && !ext.status.locked;
  const found = account.state.kind === 'found' ? account.state.account : null;

  let step: number;
  let body: ReactNode;
  if (pairedNow || (alreadyPaired && !owner)) {
    step = 3;
    body = <FirstMoveStep />;
  } else if (!owner) {
    step = 0;
    body = (
      <Step title="Connect your Sui wallet">
        <p className="text-body-lg text-text-secondary">Ferry uses your wallet to own your memory account. It never moves funds without asking.</p>
        <WalletPicker />
        <p className="text-small text-text-tertiary">About 90 seconds, and at most two wallet signatures.</p>
      </Step>
    );
  } else if (!found) {
    step = 1;
    body = <AccountStep owner={owner} account={account} />;
  } else if (!pairingHere && alreadyPaired && ext.kind === 'ready' && ext.status.accountId === found.accountId) {
    step = 3;
    body = (
      <>
        <p className="mb-8 flex items-center gap-2 text-body text-text-secondary">
          <VerifyCheck state="static" /> This browser is already paired with your memory account.
        </p>
        <FirstMoveStep />
      </>
    );
  } else {
    step = 2;
    body = <PairStep account={found} onPaired={() => setPairedNow(true)} />;
  }
  const onPairStep = step === 2;
  useEffect(() => {
    if (onPairStep) setPairingHere(true);
  }, [onPairStep]);

  return (
    <div className="mx-auto max-w-[560px]">
      <Stepper current={step} />
      {owner ? (
        <div className="mb-6">
          <ConnectedWallet />
        </div>
      ) : null}
      {found && step >= 1 ? (
        <p className="mb-6 flex flex-wrap items-center gap-2 text-small text-text-secondary">
          Found your memory account <MonoId value={found.accountId} kind="Account object id" href={explorer.object(found.accountId)} />
        </p>
      ) : null}
      {body}
    </div>
  );
}
