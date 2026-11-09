import type { Metadata } from 'next';
import { LockKeyhole, Server } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/app-shell';
import { BackupPanel } from './backup-panel';
import { ExportActions } from './export-actions';

export const metadata: Metadata = { title: 'Settings' };

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id ?? title}-title`} className="grid gap-4 border-t border-border-hairline py-8 first:border-t-0 first:pt-0 md:grid-cols-12">
      <h2 id={`${id ?? title}-title`} className="text-title font-semibold text-text-primary md:col-span-4">
        {title}
      </h2>
      <div className="flex flex-col gap-4 text-body-lg text-text-secondary md:col-span-8 [&_p]:max-w-[56ch]">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-[720px]">
      <PageHeader title="Settings">
        Most switches live in the Ferry side panel, next to the chats they affect. Open it with Alt F. This page explains what they do.
      </PageHeader>

      <Section id="privacy" title="Privacy mode">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-md border border-border-hairline bg-surface-1 p-4">
            <span className="inline-flex items-center gap-2 text-body font-medium text-text-primary">
              <Server size={16} strokeWidth={1.75} aria-hidden="true" /> Standard
            </span>
            <span className="text-small text-text-secondary">The relayer sees text while it processes it. Not end to end encrypted.</span>
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-border-hairline bg-surface-1 p-4">
            <span className="inline-flex items-center gap-2 text-body font-medium text-text-primary">
              <LockKeyhole size={16} strokeWidth={1.75} aria-hidden="true" /> Vault
            </span>
            <span className="text-small text-text-secondary">
              Encrypted with Seal on this device. Seal sessions are signed by this browser&apos;s paired key, so there is no wallet popup.
            </span>
          </div>
        </div>
        <p>
          Standard mode: the hosted Walrus Memory relayer encrypts and stores your facts, but it sees the text while it processes them. That is
          convenient, and it is not end to end encryption. Vault mode: your browser creates the search embeddings and encrypts each fact with
          Seal before anything leaves this device, so the relayer never sees the text. It still sees the vectors, your account owner address,
          the namespace and when you search. To create embeddings, the text is sent to the embedding provider you choose, with your own key.
        </p>
        <p className="text-body">Switch modes in the side panel, Settings tab.</p>
      </Section>

      <Section id="forget" title="What forget means">
        <p>
          Ferry will hide this fact everywhere and write a tombstone to Walrus, so no device of yours inserts it again. Walrus Memory has no
          delete, so the encrypted copy stays in Walrus storage until its storage epoch ends. After that it is gone. Each hidden fact shows
          its end epoch in the Library.
        </p>
      </Section>

      <Section id="saving" title="Saving from chats">
        <p>Ferry only saves your own messages, and only when you say so. Saving automatically is off by default on every site.</p>
        <p className="text-body">
          Per site switches for offering context, offering to save and saving automatically live in the side panel. Card numbers, government
          ids, passwords and keys are always blocked.
        </p>
      </Section>

      <Section id="keys" title="Device keys">
        <p>Every key can read your whole account. Review and remove keys on the Devices page.</p>
        <Link href="/devices" className="text-body text-accent underline-offset-[3px] hover:underline">
          Open Devices
        </Link>
      </Section>

      <Section id="backup" title="Encrypted backup">
        <BackupPanel />
      </Section>

      <Section id="export" title="Export and leave">
        <p>Download every fact with its receipts. The export is built on this device from your memory, through the extension.</p>
        <ExportActions />
      </Section>

      <Section id="local" title="Delete local data">
        <p>
          This clears Ferry from this browser. Your memories on Walrus are not affected and can be restored after pairing again. For safety,
          only the side panel can do it: open it with Alt F, then Settings, Danger zone.
        </p>
      </Section>
    </div>
  );
}
