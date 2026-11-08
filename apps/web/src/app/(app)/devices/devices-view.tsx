'use client';

import { buildRemoveDelegateKeyTx } from '@ferry/chain/tx';
import type { AccountView, DelegateKeyInfo } from '@ferry/core';
import {
  Badge,
  Button,
  DataCell,
  DataHead,
  DataRow,
  DataTable,
  Dialog,
  EmptyState,
  LoadingText,
  MonoId,
  Notice,
  Skeleton,
  SkeletonGroup,
  useToast,
} from '@ferry/ui';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { Info, KeyRound, RotateCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useExtension } from '@/components/extension-context';
import { ConnectedWallet, WalletPicker, hexToBytes } from '@/components/wallet';
import { getAccount, getAccountByOwner } from '@/lib/api';
import { daysSince, formatDate } from '@/lib/format';
import { explorer } from '@/lib/links';
import { useResource } from '@/lib/use-resource';

const STALE_DAYS = 30;

function normalizeHex(value: string): string {
  return value.toLowerCase().replace(/^0x/, '');
}

function RemoveDialog({
  target,
  account,
  isThisBrowser,
  onClose,
  onRemoved,
}: {
  target: DelegateKeyInfo | null;
  account: AccountView;
  isThisBrowser: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const dAppKit = useDAppKit();
  const wallet = useCurrentAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = wallet?.address.toLowerCase() === account.owner.toLowerCase();

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const tx = buildRemoveDelegateKeyTx({ accountId: account.accountId, publicKey32: hexToBytes(target.publicKey) });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        setError(`The transaction failed on Sui: ${result.FailedTransaction.status.error?.message ?? 'no reason given'}. Nothing changed.`);
        return;
      }
      onRemoved();
    } catch {
      setError('The wallet did not sign. The key is still on your account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Remove this key?"
      description={`Removing “${target?.label ?? ''}” stops that device from reading or writing your memory. This needs one signature from your wallet.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={KeyRound} loading={busy} loadingLabel="Removing" disabled={!isOwner} onClick={() => void remove()}>
            Remove key
          </Button>
        </>
      }
    >
      {isThisBrowser ? (
        <Notice tone="warning">This is the key for this browser. Ferry stops reading and writing here as soon as Sui confirms the removal.</Notice>
      ) : null}
      {!isOwner ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-text-secondary">Connect the wallet that owns this account to sign the removal.</p>
          <WalletPicker />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function KeysTable({ account, thisKey, onReload }: { account: AccountView; thisKey: string | null; onReload: () => void }) {
  const toast = useToast();
  const [target, setTarget] = useState<DelegateKeyInfo | null>(null);
  const sorted = [...account.delegates].sort((a, b) => {
    if (thisKey && normalizeHex(a.publicKey) === thisKey) return -1;
    if (thisKey && normalizeHex(b.publicKey) === thisKey) return 1;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No keys on this account"
        action={
          <Link href="/start" className="inline-flex h-9 items-center rounded-sm bg-accent px-3.5 text-body font-medium text-accent-fg hover:bg-accent-hover">
            Pair this browser
          </Link>
        }
      >
        Pair this browser to start.
      </EmptyState>
    );
  }

  return (
    <>
      <DataTable caption="Device keys on your Walrus Memory account">
        <DataHead
          columns={[
            { label: 'Label' },
            { label: 'Key' },
            { label: 'Added' },
            { label: 'Seen by Ferry' },
            { label: 'Device' },
            { label: 'Actions', srOnly: true },
          ]}
        />
        <tbody>
          {sorted.map((key) => {
            const mine = thisKey !== null && normalizeHex(key.publicKey) === thisKey;
            const age = key.createdAt ? daysSince(key.createdAt) : null;
            const stale = !mine && age !== null && age > STALE_DAYS;
            const isFerry = key.label.startsWith('Ferry on');
            return (
              <DataRow key={key.publicKey} selected={mine} tone={stale ? 'warning' : 'default'}>
                <DataCell className="font-medium text-text-primary">
                  {key.label || 'No label'}
                  {mine ? <span className="ml-2 text-small font-normal text-accent">This browser</span> : null}
                </DataCell>
                <DataCell>
                  <MonoId value={normalizeHex(key.publicKey)} kind="Public key" />
                </DataCell>
                <DataCell className="tabular whitespace-nowrap text-text-secondary">{key.createdAt ? formatDate(key.createdAt) : 'Unknown'}</DataCell>
                <DataCell className="whitespace-nowrap">
                  {mine ? (
                    <span className="text-text-secondary">Now</span>
                  ) : stale ? (
                    <span className="inline-flex items-center gap-1.5 text-warning">
                      <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
                      Not seen in {age} days
                    </span>
                  ) : (
                    <span className="text-text-tertiary">Not from this browser</span>
                  )}
                </DataCell>
                <DataCell>{isFerry ? <Badge variant="accent">Ferry</Badge> : <Badge>Other app</Badge>}</DataCell>
                <DataCell align="right">
                  <Button size="sm" variant="ghost" onClick={() => setTarget(key)}>
                    Remove
                  </Button>
                </DataCell>
              </DataRow>
            );
          })}
        </tbody>
      </DataTable>
      <RemoveDialog
        target={target}
        account={account}
        isThisBrowser={target !== null && thisKey !== null && normalizeHex(target.publicKey) === thisKey}
        onClose={() => setTarget(null)}
        onRemoved={() => {
          setTarget(null);
          toast.show({ message: 'Key removed on Sui.' });
          onReload();
        }}
      />
    </>
  );
}

export function DevicesView() {
  const { state } = useExtension();
  const wallet = useCurrentAccount();
  const status = state.kind === 'ready' ? state.status : null;
  const accountId = status?.accountId ?? null;
  const thisKey = status?.publicKeyHex ? normalizeHex(status.publicKeyHex) : null;
  const account = useResource(
    accountId ? () => getAccount(accountId) : wallet ? () => getAccountByOwner(wallet.address) : null,
    accountId ?? wallet?.address ?? 'none',
  );

  return (
    <>
      <PageHeader title="Devices" actions={<ConnectedWallet />}>
        Every key below can read and write your whole memory account. Remove any you do not recognise.
      </PageHeader>
      <Notice tone="info" className="mb-6">
        Walrus Memory keys cannot be limited to part of an account, so any device with a key sees everything. That is why
        Share and Earn uses a separate Public profile account.
      </Notice>

      {!accountId && !wallet ? (
        <div className="flex max-w-[480px] flex-col gap-4">
          <p className="text-body text-text-secondary">Connect the wallet that owns your memory account to see its keys.</p>
          <WalletPicker />
        </div>
      ) : account.status === 'loading' ? (
        <SkeletonGroup label="Reading your account from Sui through Tatum" className="flex flex-col gap-3">
          <LoadingText>Reading your account from Sui through Tatum</LoadingText>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </SkeletonGroup>
      ) : account.status === 'error' ? (
        <Notice
          tone="danger"
          live
          action={
            <Button size="sm" icon={RotateCw} onClick={account.reload}>
              Retry
            </Button>
          }
        >
          Could not read your account object. {account.error.message}
        </Notice>
      ) : account.data === null ? (
        <EmptyState
          icon={Info}
          title="No memory account for this wallet"
          action={
            <Link href="/start" className="inline-flex h-9 items-center rounded-sm bg-accent px-3.5 text-body font-medium text-accent-fg hover:bg-accent-hover">
              Create memory account
            </Link>
          }
        >
          Creating one is one transaction on Sui Mainnet.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-small text-text-secondary">
            <span className="inline-flex items-center gap-2">
              Account <MonoId value={account.data.accountId} kind="Account object id" href={explorer.object(account.data.accountId)} />
            </span>
            <span>
              <span className="tabular text-text-primary">{account.data.delegates.length}</span> of 20 keys used
            </span>
            <span>Read through Tatum Sui gRPC</span>
          </div>
          <KeysTable account={account.data} thisKey={thisKey} onReload={account.reload} />
        </div>
      )}
    </>
  );
}
