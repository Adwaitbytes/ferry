import { Button, Input, MonoId, Notice } from '@ferry/ui';
import { KeyRound, Lock, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FERRY_WEB_ORIGIN } from '../lib/config';
import type { StatusData } from '../lib/protocol';
import { openFerry } from './client';

const MIN_PASSPHRASE = 8;

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-title font-semibold">{title}</h1>
      <p className="max-w-[56ch] text-body text-text-secondary">{children}</p>
    </div>
  );
}

export function SetupScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = confirm.length > 0 && confirm !== passphrase;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE || confirm !== passphrase) return;
    setBusy(true);
    setError(null);
    const res = await openFerry<StatusData>(passphrase);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPassphrase('');
    setConfirm('');
    await onDone();
  };

  return (
    <form className="mt-6 flex flex-col gap-5" onSubmit={(e) => void submit(e)}>
      <Heading title="Create a passphrase">
        Ferry makes a key for this browser and seals it with your passphrase. The key never leaves
        this device. You will type the passphrase again after Ferry locks itself.
      </Heading>
      <Input
        label="Passphrase"
        type="password"
        autoComplete="new-password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        error={tooShort ? `Use at least ${MIN_PASSPHRASE} characters.` : null}
        helper="Four or more random words work well."
      />
      <Input
        label="Type it again"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? 'The two passphrases differ.' : null}
      />
      {error !== null ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      <Button
        type="submit"
        icon={KeyRound}
        loading={busy}
        loadingLabel="Sealing the key"
        disabled={passphrase.length < MIN_PASSPHRASE || confirm !== passphrase}
      >
        Create key and open Ferry
      </Button>
      <p className="text-small text-text-tertiary">
        Ferry cannot recover a forgotten passphrase. Your memories stay on Walrus; you would pair a
        new key from Devices.
      </p>
    </form>
  );
}

export function LockScreen({
  autoLockMinutes,
  onDone,
}: {
  autoLockMinutes: number;
  onDone: () => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (passphrase.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await openFerry<StatusData>(passphrase);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPassphrase('');
    await onDone();
  };

  return (
    <form className="mt-6 flex flex-col gap-5" onSubmit={(e) => void submit(e)}>
      <div className="flex size-10 items-center justify-center rounded-md bg-surface-3 text-text-secondary">
        <Lock size={20} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <Heading title="Ferry is locked">
        Ferry locks after {autoLockMinutes} minutes idle, and the key is cleared from memory.
      </Heading>
      <Input
        label="Passphrase"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        error={error}
      />
      <Button
        type="submit"
        loading={busy}
        loadingLabel="Opening Ferry"
        disabled={passphrase.length === 0}
      >
        Open Ferry
      </Button>
    </form>
  );
}

export function PairScreen({
  status,
  onRefresh,
}: {
  status: StatusData;
  onRefresh: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const pairUrl = `${FERRY_WEB_ORIGIN}/pair`;

  return (
    <div className="mt-6 flex flex-col gap-5">
      <Heading title="Pair this browser to start">
        The Ferry web app asks your wallet to add this browser&apos;s key to your Walrus Memory
        account. One signature, no SUI needed when sponsored gas is available.
      </Heading>
      {status.publicKeyHex !== null && status.fingerprint !== null ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-4 shadow-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-small text-text-secondary">Key fingerprint</span>
            <span className="font-mono text-[15px] tracking-[0.04em]">{status.fingerprint}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-small text-text-secondary">Public key</span>
            <MonoId value={status.publicKeyHex} kind="Delegate public key" />
          </div>
          <p className="text-small text-text-tertiary">
            Check that the web app shows the same fingerprint before you sign.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <a
          href={pairUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-2 rounded-sm bg-accent px-3 text-body font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-hover"
        >
          <Wallet size={16} strokeWidth={1.75} aria-hidden="true" />
          Open pairing
        </a>
        <Button
          variant="secondary"
          loading={checking}
          loadingLabel="Checking"
          onClick={() => {
            setChecking(true);
            void onRefresh().finally(() => setChecking(false));
          }}
        >
          I signed it
        </Button>
      </div>
      <p className="text-small text-text-tertiary">
        Every key can read your whole account. You can remove this one from Devices at any time.
      </p>
    </div>
  );
}
