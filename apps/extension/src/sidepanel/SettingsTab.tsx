import {
  ALWAYS_BLOCKED,
  SENSITIVE_CATEGORIES,
  Site,
  type ExportBundle,
  type ExtensionStatus,
  type SensitiveCategory,
} from '@ferry/core';
import { Button, Dialog, Input, LoadingText, Notice, Toggle, useToast } from '@ferry/ui';
import { Download, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AUTO_LOCK_CHOICES, SITE_LABEL } from '../lib/config';
import { call } from './client';
import { forgetCopy } from './LibraryTab';
import { useSettings } from './useSettings';
import { VaultSection } from './VaultSection';

const WIPE_PHRASE = 'DELETE MY FERRY DATA';

const SENSITIVE_LABEL: Record<SensitiveCategory, string> = {
  health: 'Health details',
  finance: 'Finance numbers',
  government_id: 'Government ids',
  password: 'Passwords',
  card_number: 'Card numbers',
  secret_key: 'Secret keys',
  precise_location: 'Precise location',
  sexuality: 'Sexuality',
  religion: 'Religion',
  politics: 'Politics',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border-hairline pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SettingsTab({
  site,
  status,
  onChanged,
}: {
  site: Site | null;
  status: ExtensionStatus;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const { settings, error, update } = useSettings();
  const [exporting, setExporting] = useState<'json' | 'md' | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [wiping, setWiping] = useState(false);

  if (settings === null) {
    return error !== null ? (
      <Notice tone="danger" title="Could not read settings" live>
        {error}
      </Notice>
    ) : (
      <LoadingText>Reading settings</LoadingText>
    );
  }

  const sites =
    site !== null ? [site, ...Site.options.filter((s) => s !== site)] : [...Site.options];

  const runExport = async (kind: 'json' | 'md') => {
    setExporting(kind);
    const res = await call<ExportBundle>({ type: 'data.export' });
    setExporting(null);
    if (!res.ok) {
      toast.show({ message: res.message, tone: 'error' });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'json')
      download(`ferry-memory-${stamp}.pam.json`, 'application/json', res.data.pam);
    else download(`ferry-memory-${stamp}.md`, 'text/markdown', res.data.markdown);
    toast.show({ message: `Exported ${res.data.count} facts`, tone: 'success' });
  };

  const wipe = async () => {
    if (wipeText !== WIPE_PHRASE) return;
    setWiping(true);
    const res = await call({ type: 'data.wipe', confirm: WIPE_PHRASE });
    setWiping(false);
    if (!res.ok) {
      toast.show({ message: res.message, tone: 'error' });
      return;
    }
    setWipeOpen(false);
    setWipeText('');
    toast.show({ message: 'Ferry data deleted from this browser', tone: 'success' });
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="Sites">
        {sites.map((s) => (
          <div
            key={s}
            className="flex flex-col gap-3 rounded-md border border-border-hairline bg-surface-1 p-4 shadow-1"
          >
            <h3 className="text-body font-medium">{SITE_LABEL[s]}</h3>
            <Toggle
              label="Offer context"
              showState
              checked={settings.sites[s].inject}
              onCheckedChange={(v) => void update({ sites: { [s]: { inject: v } } })}
            />
            <Toggle
              label="Offer to save"
              showState
              checked={settings.sites[s].capture}
              onCheckedChange={(v) => void update({ sites: { [s]: { capture: v } } })}
            />
            <Toggle
              label="Save automatically"
              showState
              description="Off by default. Sensitive details and anything flagged always ask first."
              checked={settings.sites[s].auto}
              onCheckedChange={(v) => void update({ sites: { [s]: { auto: v } } })}
            />
            <Toggle
              label="Always attach on new chats"
              showState
              checked={settings.sites[s].alwaysAttach}
              onCheckedChange={(v) => void update({ sites: { [s]: { alwaysAttach: v } } })}
            />
          </div>
        ))}
      </Section>

      <Section title="Sensitive categories">
        <p className="text-small text-text-tertiary">
          Off by default. When on, Rescue offers these facts for review instead of setting them
          aside.
        </p>
        {SENSITIVE_CATEGORIES.map((c) =>
          ALWAYS_BLOCKED.includes(c) ? (
            <Toggle
              key={c}
              label={SENSITIVE_LABEL[c]}
              checked={false}
              onCheckedChange={() => undefined}
              disabled
              disabledReason="Always blocked. Ferry never stores these."
            />
          ) : (
            <Toggle
              key={c}
              label={SENSITIVE_LABEL[c]}
              showState
              checked={settings.sensitiveAllowed.includes(c)}
              onCheckedChange={(v) =>
                void update({
                  sensitiveAllowed: v
                    ? [...settings.sensitiveAllowed, c]
                    : settings.sensitiveAllowed.filter((x) => x !== c),
                })
              }
            />
          ),
        )}
      </Section>

      <Section title="Auto lock">
        <label className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-body font-medium">
            <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
            Lock after idle
          </span>
          <select
            className="h-8 rounded-sm border border-border-control bg-surface-2 px-2 text-body text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            value={settings.autoLockMinutes}
            onChange={(e) => void update({ autoLockMinutes: Number(e.target.value) })}
          >
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <p className="text-small text-text-tertiary">
          On lock, the key is cleared from memory. You type the passphrase to open Ferry again.
        </p>
      </Section>

      <Section title="Privacy mode">
        <VaultSection paired={status.account !== null} />
      </Section>

      <Section title="What forget means">
        <p className="max-w-[56ch] text-small text-text-secondary">{forgetCopy(null)}</p>
      </Section>

      <Section title="Export">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            icon={Download}
            loading={exporting === 'json'}
            loadingLabel="Exporting"
            onClick={() => void runExport('json')}
          >
            Export JSON (PAM compatible)
          </Button>
          <Button
            variant="secondary"
            icon={Download}
            loading={exporting === 'md'}
            loadingLabel="Exporting"
            onClick={() => void runExport('md')}
          >
            Export Markdown
          </Button>
        </div>
      </Section>

      <Section title="Danger zone">
        <p className="max-w-[56ch] text-small text-text-secondary">
          This clears Ferry from this browser. Your memories on Walrus are not affected and can be
          restored after pairing again.
        </p>
        <Button variant="danger" icon={Trash2} onClick={() => setWipeOpen(true)}>
          Delete all local Ferry data
        </Button>
        {status.account !== null ? (
          <p className="text-small text-text-tertiary">
            This browser&apos;s key stays registered on your account until you remove it from
            Devices.
          </p>
        ) : null}
      </Section>

      <Dialog
        open={wipeOpen}
        onOpenChange={(o) => {
          setWipeOpen(o);
          if (!o) setWipeText('');
        }}
        title="Delete all local Ferry data?"
        description="The sealed key, settings and the local index are removed from this browser."
        footer={
          <>
            <Button variant="secondary" onClick={() => setWipeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              disabled={wipeText !== WIPE_PHRASE}
              loading={wiping}
              loadingLabel="Deleting"
              onClick={() => void wipe()}
            >
              Delete local data
            </Button>
          </>
        }
      >
        <Input
          label={`Type ${WIPE_PHRASE} to confirm`}
          value={wipeText}
          onChange={(e) => setWipeText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Dialog>
    </div>
  );
}
