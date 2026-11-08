import type { ExtensionStatus, ImportProgress, RecentCapture, Site } from '@ferry/core';
import { Badge, Button, EmptyState, LoadingText, Notice, Progress, Toggle } from '@ferry/ui';
import { CircleSlash, Clock, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { SITE_HOST, SITE_LABEL } from '../lib/config';
import { IMPORT_PORT } from '../lib/protocol';
import { call } from './client';
import { useSettings } from './useSettings';

const CAPTURE_STATE_LABEL: Record<RecentCapture['state'], string> = {
  offered: 'Offered',
  saved: 'Saved',
  auto_saved: 'Saved automatically',
  dismissed: 'Not saved',
  conflict: 'Conflict',
  failed: 'Not saved',
};

function secondsUntil(at: number | string | undefined | null): number | null {
  if (at === undefined || at === null) return null;
  const ms = (typeof at === 'number' ? at : Date.parse(at)) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : null;
}

/** Live import progress over a port, so the counter updates without polling the worker. */
function useImportProgress(initial: ImportProgress): ImportProgress {
  const [progress, setProgress] = useState(initial);
  useEffect(() => {
    const port = browser.runtime.connect({ name: IMPORT_PORT });
    port.onMessage.addListener((p: ImportProgress) => setProgress(p));
    return () => port.disconnect();
  }, []);
  return progress;
}

function ImportCard({ initial }: { initial: ImportProgress }) {
  const p = useImportProgress(initial);
  if (p.total === 0) return null;
  const resumeIn = secondsUntil(p.resumeAt);
  const helper =
    p.state === 'cooling_down'
      ? `Cooling down to respect Walrus limits.${resumeIn !== null ? ` Resuming in ${resumeIn}s.` : ''}`
      : p.state === 'done'
        ? `Done. ${p.failed > 0 ? `${p.failed} could not be written; they stay queued for a retry.` : 'Every fact has a receipt.'}`
        : p.state === 'error'
          ? 'The import stopped. Open Ferry again to resume where it left off.'
          : p.state === 'paused'
            ? 'Paused. Ferry keeps your place.'
            : 'You can close this tab, Ferry will resume.';
  return (
    <Progress
      label="Moving facts to Walrus"
      value={p.written}
      max={p.total}
      valueText={`${p.written} of ${p.total}`}
      ariaValueText={`${p.written} of ${p.total} facts moved`}
      helper={helper}
      tone={p.state === 'cooling_down' ? 'warning' : p.state === 'error' ? 'danger' : 'accent'}
    />
  );
}

export function NowTab({
  status,
  site,
  onChanged,
}: {
  status: ExtensionStatus;
  site: Site | null;
  onChanged: () => Promise<void>;
}) {
  const { settings, update } = useSettings();
  const [locking, setLocking] = useState(false);
  const coolingFor = secondsUntil(status.governor.kind === 'cooling_down' ? status.governor.resumeAt : null);
  const health = site !== null ? status.adapters?.[site] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ferry-site" className="flex flex-col gap-3">
        <h2 id="ferry-site" className="sr-only">
          This site
        </h2>
        {site === null ? (
          <EmptyState icon={CircleSlash} title="No chat app in this tab">
            Ferry works on ChatGPT, Claude and Gemini. Open one of them to see suggestions.
          </EmptyState>
        ) : settings === null ? (
          <LoadingText>Reading this site&apos;s settings</LoadingText>
        ) : (
          <>
            <p className="text-body text-text-secondary">
              On {SITE_HOST[site]}. Offering context: {settings.sites[site].inject ? 'On' : 'Off'}.
            </p>
            {health !== undefined && !health.ok ? (
              <Notice tone="warning" title="Adapter degraded">
                Ferry cannot read this page&apos;s layout right now. {SITE_LABEL[site]} may have
                changed it. Your chats are not affected.
              </Notice>
            ) : null}
            <div className="flex flex-col gap-4 rounded-md border border-border-hairline bg-surface-1 p-4 shadow-1">
              <Toggle
                label="Offer context"
                showState
                checked={settings.sites[site].inject}
                onCheckedChange={(v) => void update({ sites: { [site]: { inject: v } } })}
              />
              <Toggle
                label="Offer to save"
                showState
                checked={settings.sites[site].capture}
                onCheckedChange={(v) => void update({ sites: { [site]: { capture: v } } })}
              />
              <Toggle
                label={`Save automatically on ${SITE_LABEL[site]}`}
                showState
                description="Sensitive details and anything flagged always ask first."
                checked={settings.sites[site].auto}
                onCheckedChange={(v) => void update({ sites: { [site]: { auto: v } } })}
              />
            </div>
          </>
        )}
      </section>

      {coolingFor !== null ? (
        <Notice tone="warning" title="Cooling down" live>
          Cooling down to respect Walrus limits. Resuming in {coolingFor}s.
        </Notice>
      ) : null}

      <ImportCard initial={status.importProgress} />

      <section aria-labelledby="ferry-recent" className="flex flex-col gap-3">
        <h2 id="ferry-recent" className="text-body font-medium text-text-secondary">
          Recent captures
        </h2>
        {(status.recentCaptures ?? []).length === 0 ? (
          <p className="text-body text-text-tertiary">
            Nothing yet. When you tell {site !== null ? SITE_LABEL[site] : 'a chat app'} something
            durable about yourself, Ferry offers to save it. Ferry only saves your own messages, and
            only when you say so.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-hairline rounded-md border border-border-hairline bg-surface-1">
            {(status.recentCaptures ?? []).map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <span className="min-w-0 text-body text-text-primary [overflow-wrap:anywhere]">
                  {c.text}
                </span>
                <Badge
                  variant={
                    c.state === 'saved' || c.state === 'auto_saved'
                      ? 'accent'
                      : c.state === 'conflict'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {CAPTURE_STATE_LABEL[c.state]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-border-hairline pt-4">
        <span className="inline-flex items-center gap-2 text-small text-text-tertiary">
          <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
          Locks after {status.autoLockMinutes} minutes idle
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={Lock}
          loading={locking}
          loadingLabel="Locking"
          onClick={() => {
            setLocking(true);
            void call({ type: 'lock' })
              .then(onChanged)
              .finally(() => setLocking(false));
          }}
        >
          Lock now
        </Button>
      </div>
    </div>
  );
}
