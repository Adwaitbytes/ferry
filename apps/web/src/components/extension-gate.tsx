'use client';

import { Button, EmptyState, LoadingText } from '@ferry/ui';
import { CircleAlert, KeyRound, Lock, PanelRight, Puzzle, RotateCw } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { bridgeConfigured, type ExtensionStatus } from '@/lib/bridge';
import { publicEnv } from '@/lib/env';
import { installSteps } from '@/lib/links';
import { PageHeader } from './app-shell';
import { useExtension } from './extension-context';

export function InstallSteps() {
  return (
    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body text-text-secondary marker:text-text-tertiary">
      {installSteps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export function NotInstalled({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={Puzzle}
      title="Ferry is not in this browser yet"
      action={
        <a
          href={publicEnv.releaseUrl}
          className="inline-flex h-9 items-center rounded-sm bg-accent px-3.5 text-body font-medium text-accent-fg hover:bg-accent-hover"
        >
          Download Ferry for Chrome
        </a>
      }
      secondary={
        <Button variant="ghost" icon={RotateCw} onClick={onRetry}>
          Check again
        </Button>
      }
    >
      <p className="mb-3">
        This page reaches your memory only through the Ferry extension, which holds your device key. Nothing here talks to
        Walrus Memory directly.
      </p>
      {bridgeConfigured() || process.env.NODE_ENV === 'production' ? null : (
        <p className="mb-3 text-text-tertiary">This deployment has no extension id configured, so it cannot find Ferry.</p>
      )}
      <InstallSteps />
    </EmptyState>
  );
}

/**
 * Renders children only when the extension is installed, open and paired. Every other state is a
 * designed screen with one way forward.
 */
export function ExtensionGate({ title, children }: { title: string; children: (status: ExtensionStatus) => ReactNode }) {
  const { state } = useExtension();
  const ready = state.kind === 'ready' && !state.status.locked && state.status.paired;
  if (ready) return <>{children(state.status)}</>;
  return (
    <>
      <PageHeader title={title} />
      <GateState />
    </>
  );
}

function GateState() {
  const { state, refresh } = useExtension();
  if (state.kind === 'checking') return <LoadingText>Looking for the Ferry extension in this browser</LoadingText>;
  if (state.kind === 'not_installed') return <NotInstalled onRetry={() => void refresh()} />;
  if (state.kind === 'error') {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Ferry did not answer"
        action={
          <Button icon={RotateCw} onClick={() => void refresh()}>
            Try again
          </Button>
        }
      >
        {state.message}
      </EmptyState>
    );
  }
  if (state.status.locked) {
    return (
      <EmptyState
        icon={Lock}
        title="Ferry is locked"
        action={
          <Button icon={RotateCw} onClick={() => void refresh()}>
            I opened it, check again
          </Button>
        }
      >
        <p>
          Open the Ferry side panel with <kbd className="rounded-xs bg-surface-3 px-1 text-small">Alt F</kbd> or the{' '}
          <PanelRight size={14} strokeWidth={1.75} className="inline align-[-2px]" aria-label="side panel" /> button, and enter
          your passphrase. Your key stays inside the extension.
        </p>
      </EmptyState>
    );
  }
  if (!state.status.paired) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Pair this browser to start"
        action={
          <Link
            href="/start"
            className="inline-flex h-9 items-center rounded-sm bg-accent px-3.5 text-body font-medium text-accent-fg hover:bg-accent-hover"
          >
            Pair this browser
          </Link>
        }
      >
        Ferry adds a key for this browser to your Walrus Memory account. It takes one wallet signature.
      </EmptyState>
    );
  }
  return null;
}
