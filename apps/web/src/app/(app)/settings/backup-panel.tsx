'use client';

import { Button, EmptyState, MonoId, Notice, useToast } from '@ferry/ui';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import { ArchiveRestore, FileArchive, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { WalletPicker } from '@/components/wallet';
import { getAccountByOwner } from '@/lib/api';
import {
  BACKUP_EPOCHS,
  checkExportFile,
  formatBytes,
  readBackups,
  safeFileName,
  saveBackup,
  type BackupRecord,
  type KeyValueStore,
} from '@/lib/backup';
import type { BackupStep, WalletPort } from '@/lib/backup-chain';
import { SUI_FULLNODE_URL, publicEnv } from '@/lib/env';
import { formatDateTime } from '@/lib/format';
import { explorer } from '@/lib/links';

const STEP_TEXT: Record<BackupStep, string> = {
  encrypting: 'Encrypting the ZIP with Seal on this device',
  encoding: 'Encoding the ciphertext for Walrus',
  registering: 'Approve the storage registration in your wallet',
  uploading: 'Uploading through the Walrus upload relay',
  certifying: 'Approve the certification in your wallet',
};

type Run =
  | { kind: 'idle' }
  | { kind: 'working'; step: BackupStep | 'reading' }
  | { kind: 'error'; message: string };

const noSubscribe = () => () => undefined;

let mainnet: SuiGrpcClient | null = null;
/** One gRPC-Web client to the public fullnode: Seal and the Walrus SDK cannot use Tatum (RESEARCH 6). */
function mainnetClient(): SuiGrpcClient {
  mainnet ??= new SuiGrpcClient({ network: 'mainnet', baseUrl: SUI_FULLNODE_URL });
  return mainnet;
}

function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Wallet errors carry wallet wording; the page says what happened in its own words instead. */
function describeFailure(error: unknown, during: string): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'BackupFormatError' || name === 'BackupError') return (error as Error).message;
  if (/reject|denied|declin|cancel/i.test(error instanceof Error ? error.message : '')) return `The wallet did not approve ${during}. Nothing else changed.`;
  return `Could not finish ${during}. Check that the wallet holds SUI for gas and WAL for storage, then try again.`;
}

function useWalletPort(): WalletPort | null {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  if (!account) return null;
  const client = mainnetClient();
  return {
    address: account.address,
    async signAndExecute(transaction: Transaction) {
      const result = await dAppKit.signAndExecuteTransaction({ transaction });
      if (result.FailedTransaction) {
        throw new Error(`Sui rejected the transaction: ${result.FailedTransaction.status.error?.message ?? 'no reason given'}`);
      }
      // The relay checks the registration on chain, so wait until the fullnode has it.
      await client.waitForTransaction({ digest: result.Transaction.digest });
      return result.Transaction.digest;
    },
    async signPersonalMessage(message: Uint8Array) {
      return (await dAppKit.signPersonalMessage({ message })).signature;
    },
  };
}

function BackupRow({ record, wallet }: { record: BackupRecord; wallet: WalletPort | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = wallet !== null && wallet.address.toLowerCase() === record.owner.toLowerCase();

  const restore = async () => {
    if (wallet === null) return;
    setBusy(true);
    setError(null);
    try {
      const { restoreBackup } = await import('@/lib/backup-chain');
      const file = await restoreBackup({ suiClient: mainnetClient(), wallet, record, aggregatorUrl: publicEnv.aggregatorUrl });
      download(file.name, file.bytes);
      toast.show({ message: `Restored ${safeFileName(file.name)} to your downloads.`, tone: 'success' });
    } catch (e) {
      setError(describeFailure(e, 'the restore'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-4 shadow-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-body font-medium text-text-primary [overflow-wrap:anywhere]">{record.fileName}</span>
          <span className="text-small text-text-tertiary">Backed up {formatDateTime(record.createdAt)}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={ArchiveRestore}
          loading={busy}
          loadingLabel="Restoring"
          disabled={!isOwner}
          onClick={() => void restore()}
        >
          Restore
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-small">
        <dt className="text-text-secondary">Walrus blob</dt>
        <dd className="min-w-0">
          <MonoId value={record.blobId} kind="Walrus blob" href={explorer.blob(record.blobId)} hrefLabel="Open in Walruscan" />
        </dd>
        <dt className="text-text-secondary">Size</dt>
        <dd className="tabular-nums text-text-primary">
          {formatBytes(record.size)} <span className="text-text-secondary">({formatBytes(record.encryptedSize)} encrypted)</span>
        </dd>
        <dt className="text-text-secondary">Stored until</dt>
        <dd className="tabular-nums text-text-primary">Epoch {record.endEpoch}</dd>
      </dl>
      {!isOwner ? (
        <p className="text-small text-text-tertiary">Connect the wallet that made this backup to restore it.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** F9: encrypted backup of a raw export ZIP, Seal on this device, stored on Walrus. */
export function BackupPanel() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const wallet = useWalletPort();
  const toast = useToast();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [run, setRun] = useState<Run>({ kind: 'idle' });

  useEffect(() => {
    setRecords(readBackups(browserStore()));
  }, []);

  const start = async (file: File) => {
    if (wallet === null) return;
    setRun({ kind: 'working', step: 'reading' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = checkExportFile(file, bytes.subarray(0, 4));
    if (problem !== null) {
      setRun({ kind: 'error', message: problem });
      return;
    }
    try {
      const account = await getAccountByOwner(wallet.address);
      if (account === null) {
        setRun({ kind: 'error', message: 'This wallet has no Walrus Memory account yet. Create one on Start, then back up.' });
        return;
      }
      const { createBackup } = await import('@/lib/backup-chain');
      const record = await createBackup({
        suiClient: mainnetClient(),
        wallet,
        accountId: account.accountId,
        accessCounterVersion: BigInt(account.accessCounterVersion ?? '0'),
        file: { name: file.name, bytes },
        onStep: (step) => setRun({ kind: 'working', step }),
      });
      const kept = saveBackup(browserStore(), record);
      setRecords(readBackups(browserStore()));
      if (!kept) setRecords((r) => [record, ...r]);
      setRun({ kind: 'idle' });
      toast.show({ message: `Backed up ${record.fileName}. Blob ${record.blobId.slice(0, 8)} is on Walrus.`, tone: 'success' });
    } catch (e) {
      setRun({ kind: 'error', message: describeFailure(e, 'the backup') });
    }
  };

  const working = run.kind === 'working';

  return (
    <div className="flex flex-col gap-4">
      <p>
        Keep the raw export your AI app sent you. Ferry encrypts the ZIP with Seal in this browser, under the same policy as your memory
        account, then stores the ciphertext on Walrus for about a year ({BACKUP_EPOCHS} epochs). Only your wallet and your paired devices can
        open it.
      </p>
      <p className="text-body">
        Storage is paid from your wallet in WAL, with SUI for gas and a small tip to the upload relay. Your wallet shows each amount before
        you approve. Ferry never pays for or holds anything.
      </p>

      {!hydrated ? (
        <p className="text-small text-text-secondary">Looking for Sui wallets in this browser</p>
      ) : wallet === null ? (
        <Notice tone="info" title="Needs your wallet">
          <span className="flex flex-col gap-3">
            <span>Backups are encrypted to your memory account and paid from your wallet, so connect it first.</span>
            <WalletPicker />
          </span>
        </Notice>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-border-strong bg-surface-1 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={working}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void start(file);
              }}
            />
            <Button
              variant="primary"
              icon={Upload}
              loading={working}
              loadingLabel="Backing up"
              onClick={() => inputRef.current?.click()}
            >
              Choose export ZIP
            </Button>
            <span className="inline-flex items-center gap-2 text-small text-text-tertiary">
              <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
              Encrypted before it leaves this device
            </span>
          </div>
          {run.kind === 'working' ? (
            <p role="status" className="text-small text-text-secondary">
              {run.step === 'reading' ? 'Reading the file on this device' : STEP_TEXT[run.step]}
            </p>
          ) : null}
          {run.kind === 'error' ? (
            <p role="alert" className="text-small text-danger">
              {run.message}
            </p>
          ) : null}
        </div>
      )}

      {records.length === 0 ? (
        <EmptyState icon={FileArchive} title="No backups in this browser">
          Backups you make here are listed with their Walrus blob, size and end epoch. The blob objects also live in your wallet.
        </EmptyState>
      ) : (
        <ul aria-label="Backups" className="flex flex-col gap-3">
          {records.map((r) => (
            <BackupRow key={r.blobId} record={r} wallet={wallet} />
          ))}
        </ul>
      )}
    </div>
  );
}
