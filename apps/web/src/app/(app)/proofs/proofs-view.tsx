'use client';

import {
  Badge,
  Button,
  Counter,
  DataCell,
  DataHead,
  DataRow,
  DataTable,
  EmptyState,
  LoadingText,
  MonoId,
  Notice,
  Progress,
  Skeleton,
  SkeletonGroup,
} from '@ferry/ui';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { CircleCheck, CircleDashed, Gauge, Package, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useExtension } from '@/components/extension-context';
import { getAccount, getAccountByOwner, getMeter, getStats, type MeterSnapshot } from '@/lib/api';
import { bridge } from '@/lib/bridge';
import { formatTime, plural } from '@/lib/format';
import { explorer } from '@/lib/links';
import { useResource } from '@/lib/use-resource';

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`panel-${title}`} className={`flex flex-col gap-4 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1 ${className ?? ''}`}>
      <h2 id={`panel-${title}`} className="text-title font-semibold text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="danger" live action={<Button size="sm" icon={RotateCw} onClick={onRetry}>Retry</Button>}>
      {message}
    </Notice>
  );
}

/** Which Tatum calls back each claim (PRD 5.2). Status comes from the live credit meter. */
const TATUM_USES: { title: string; detail: string; methods: string[]; pending?: string }[] = [
  { title: 'Memory account and device keys', detail: 'Pairing and Devices read your MemWalAccount object.', methods: ['GetObject', 'ListDynamicFields'] },
  { title: 'Walrus blob receipts', detail: 'Every receipt reads the blob object: owner, certified and end epoch.', methods: ['GetObject', 'BatchGetObjects', 'GetEpoch'] },
  { title: 'Payment verification', detail: 'Gate checks each USDC payment transaction before it answers an agent.', methods: ['GetTransaction'] },
  { title: 'Price data', detail: 'Earnings show a fiat value from the Tatum rate API.', methods: ['RateBySymbol'] },
  {
    title: 'Encrypted backups',
    detail: 'Raw exports encrypted with Seal and stored through the Tatum Storage API.',
    methods: ['StorageUpload'],
    pending: 'Not wired on this deployment yet.',
  },
  {
    title: 'Incoming payments',
    detail: 'Tatum has no Sui notifications, so Ferry polls ListTransactions for new USDC.',
    methods: ['ListTransactions'],
  },
];

function TatumUses({ meter }: { meter: MeterSnapshot | null }) {
  return (
    <ul className="flex flex-col divide-y divide-border-hairline">
      {TATUM_USES.map((use, index) => {
        const calls = meter ? use.methods.reduce((sum, m) => sum + (meter.methods[m]?.calls ?? 0), 0) : 0;
        const live = calls > 0;
        return (
          <li key={use.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="tabular mt-0.5 w-4 shrink-0 text-small text-text-tertiary">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-text-primary">{use.title}</p>
              <p className="text-small text-text-secondary">{use.detail}</p>
            </div>
            {live ? (
              <Badge variant="accent" icon={CircleCheck}>
                {plural(calls, 'call', 'calls')}
              </Badge>
            ) : (
              <Badge icon={CircleDashed}>{use.pending ? 'Not wired yet' : meter ? 'No calls yet' : 'Status unavailable'}</Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MeterPanel() {
  const meter = useResource(getMeter, 'meter');
  return (
    <Panel title="Tatum credit meter">
      {meter.status === 'loading' ? (
        <SkeletonGroup label="Reading the Tatum credit meter" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-1 w-full" />
          <LoadingText>Reading Mainnet through Tatum</LoadingText>
        </SkeletonGroup>
      ) : meter.status === 'error' ? (
        <>
          <PanelError message={`Could not read the credit meter. ${meter.error.message}`} onRetry={meter.reload} />
          <div className="border-t border-border-hairline pt-4">
            <h3 className="mb-3 text-body font-medium text-text-primary">Powered by Tatum</h3>
            <TatumUses meter={null} />
          </div>
        </>
      ) : (
        <>
          {meter.data.monthlyLimit ? (
            <Progress
              label="Credits used"
              value={meter.data.totalCredits}
              max={meter.data.monthlyLimit}
              valueText={`${meter.data.totalCredits.toLocaleString('en-US')} of ${meter.data.monthlyLimit.toLocaleString('en-US')}`}
              ariaValueText={`${meter.data.totalCredits} of ${meter.data.monthlyLimit} credits used`}
              helper={`Estimated by Ferry since ${formatTime(meter.data.since)}. The Tatum dashboard is the source of truth.`}
            />
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-body text-text-secondary">
                <Counter value={meter.data.totalCredits} unit="credits" className="text-title font-semibold text-text-primary" /> in{' '}
                {plural(meter.data.totalCalls, 'call', 'calls')} since {formatTime(meter.data.since)}
              </p>
              <p className="text-small text-text-tertiary">Estimated by Ferry on this server instance. The Tatum dashboard is the source of truth.</p>
            </div>
          )}
          {Object.keys(meter.data.methods).length > 0 ? (
            <DataTable caption="Tatum calls by method">
              <DataHead columns={[{ label: 'Method' }, { label: 'Calls', align: 'right' }, { label: 'Credits', align: 'right' }]} />
              <tbody>
                {Object.entries(meter.data.methods)
                  .sort(([, a], [, b]) => b.calls - a.calls)
                  .map(([method, m]) => (
                    <DataRow key={method}>
                      <DataCell className="font-mono text-[0.8125rem]">{method}</DataCell>
                      <DataCell align="right">{m.calls.toLocaleString('en-US')}</DataCell>
                      <DataCell align="right">{m.credits.toLocaleString('en-US')}</DataCell>
                    </DataRow>
                  ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="text-small text-text-tertiary">No Tatum calls on this server instance yet. Open a receipt or Devices to make one.</p>
          )}
          <div className="border-t border-border-hairline pt-4">
            <h3 className="mb-3 text-body font-medium text-text-primary">Powered by Tatum</h3>
            <TatumUses meter={meter.data} />
          </div>
        </>
      )}
    </Panel>
  );
}

function CountsPanel() {
  const stats = useResource(getStats, 'stats');
  return (
    <Panel title="Mainnet counts" className="lg:col-span-2">
      {stats.status === 'loading' ? (
        <LoadingText>Reading Mainnet through Tatum</LoadingText>
      ) : stats.status === 'error' ? (
        <PanelError message={stats.error.message} onRetry={stats.reload} />
      ) : (
        <dl className="grid gap-6 sm:grid-cols-2">
          {[
            { label: 'Memories on Walrus Mainnet', value: stats.data.memories },
            { label: 'Paid recalls settled on Sui', value: stats.data.paidRecalls },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <dt className="text-body text-text-secondary">{item.label}</dt>
              <dd className="text-display-md font-semibold tracking-[-0.02em] text-text-primary">
                {item.value === null ? <span className="text-title font-medium text-text-tertiary">Counting on Mainnet</span> : <Counter value={item.value} />}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function AccountPanel() {
  const { state } = useExtension();
  const wallet = useCurrentAccount();
  const accountId = state.kind === 'ready' ? (state.status.accountId ?? null) : null;
  const key = accountId ?? wallet?.address ?? 'none';
  const account = useResource(
    accountId ? () => getAccount(accountId) : wallet ? () => getAccountByOwner(wallet.address) : null,
    key,
  );
  if (!accountId && !wallet) {
    return (
      <Panel title="Account object">
        <p className="text-body text-text-secondary">Pair this browser or connect your wallet to see your memory account object on Sui.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Account object">
      {account.status === 'loading' ? (
        <LoadingText>Reading your account from Sui through Tatum</LoadingText>
      ) : account.status === 'error' ? (
        <PanelError message={account.error.message} onRetry={account.reload} />
      ) : account.data === null ? (
        <p className="text-body text-text-secondary">No Walrus Memory account for this wallet yet.</p>
      ) : (
        <dl className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3 text-small">
          <dt className="text-text-secondary">Account</dt>
          <dd className="min-w-0">
            <MonoId value={account.data.accountId} kind="Account object id" href={explorer.object(account.data.accountId)} />
          </dd>
          <dt className="text-text-secondary">Owner</dt>
          <dd className="min-w-0">
            <MonoId value={account.data.owner} kind="Owner address" href={explorer.account(account.data.owner)} />
          </dd>
          <dt className="text-text-secondary">Device keys</dt>
          <dd className="tabular text-text-primary">{account.data.delegates.length}</dd>
          <dt className="text-text-secondary">State</dt>
          <dd className="text-text-primary">{account.data.active ? 'Active' : 'Deactivated'}</dd>
        </dl>
      )}
    </Panel>
  );
}

function BlobsPanel() {
  const { state } = useExtension();
  const ready = state.kind === 'ready' && state.status.paired && !state.status.locked;
  const list = useResource(ready ? () => bridge({ type: 'memory.list', status: 'active' }) : null, ready ? 'blobs' : 'off');
  return (
    <Panel title="Recent blobs">
      {!ready ? (
        <p className="text-body text-text-secondary">Your recent Walrus blobs appear here once this browser is paired and Ferry is open.</p>
      ) : list.status === 'loading' ? (
        <LoadingText>Reading your memory through the extension</LoadingText>
      ) : list.status === 'error' ? (
        <PanelError message={list.error.message} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={Package} title="No memories yet">
          Proofs appear after your first save.
        </EmptyState>
      ) : (
        <DataTable caption="Most recent Walrus blobs in your memory">
          <DataHead columns={[{ label: 'Blob' }, { label: 'Ends at epoch', align: 'right' }]} />
          <tbody>
            {list.data.items.slice(0, 8).map((item) => (
              <DataRow key={item.memory.ref}>
                <DataCell>
                  <MonoId value={item.blobId} kind="Blob id" href={explorer.blob(item.blobId)} hrefLabel="Open blob in Walrus explorer" />
                </DataCell>
                <DataCell align="right">{item.endEpoch ?? 'Not reported'}</DataCell>
              </DataRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}

export function ProofsView() {
  return (
    <>
      <PageHeader title="Proofs">
        Every number Ferry shows links to something you can check yourself: an object, a blob or a transaction on Sui Mainnet.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <CountsPanel />
        <AccountPanel />
        <BlobsPanel />
        <div className="lg:col-span-2">
          <MeterPanel />
        </div>
      </div>
      <p className="mt-8 flex items-center gap-2 text-small text-text-tertiary">
        <Gauge size={14} strokeWidth={1.75} aria-hidden="true" />
        Chain reads run on the server through Tatum Sui gRPC, so the Tatum key never reaches your browser.
      </p>
    </>
  );
}
