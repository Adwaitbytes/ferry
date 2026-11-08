import type { ExtensionStatus, Site } from '@ferry/core';
import { IconButton, LoadingText, MonoId, Notice, TabPanel, Tabs, Waterline } from '@ferry/ui';
import { Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { SITE_BY_ORIGIN } from '../lib/config';
import { call } from './client';
import { LibraryTab } from './LibraryTab';
import { LockScreen, PairScreen, SetupScreen } from './LockScreens';
import { NowTab } from './NowTab';
import { SettingsTab } from './SettingsTab';

type TabValue = 'now' | 'library' | 'settings';

const TABS = [
  { value: 'now', label: 'Now' },
  { value: 'library', label: 'Library' },
  { value: 'settings', label: 'Settings' },
] as const;

const POLL_MS = 3000;

/** The chat site in the active tab. The URL is only visible for hosts Ferry has permission for. */
function useCurrentSite(): Site | null {
  const [site, setSite] = useState<Site | null>(null);
  useEffect(() => {
    const refresh = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setSite(siteOf(tab?.url));
    };
    void refresh();
    const onActivated = () => void refresh();
    const onUpdated = (_id: number, info: { url?: string }) => {
      if (info.url !== undefined) void refresh();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return site;
}

function siteOf(url: string | undefined): Site | null {
  if (url === undefined) return null;
  try {
    return SITE_BY_ORIGIN[new URL(url).origin] ?? null;
  } catch {
    return null;
  }
}

export function App() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>('now');
  const site = useCurrentSite();

  const refresh = useCallback(async () => {
    const res = await call<ExtensionStatus>({ type: 'status.get' });
    if (res.ok) {
      setStatus(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col bg-bg text-text-primary">
      <header className="sticky top-0 z-20 bg-bg">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <span className="font-display text-[16px] font-semibold leading-none tracking-[-0.01em]">
            Ferry
          </span>
          <div className="flex min-w-0 items-center gap-1">
            {status?.account ? (
              <MonoId value={status.account.accountId} kind="Memory account" copy={false} />
            ) : null}
            <IconButton
              icon={Settings2}
              label="Open settings"
              size="sm"
              onClick={() => setTab('settings')}
            />
          </div>
        </div>
        <Waterline />
      </header>

      <main className="flex-1 px-4 pb-8">
        {status === null ? (
          error !== null ? (
            <Notice tone="danger" title="Ferry is not responding" className="mt-6" live>
              {error}
            </Notice>
          ) : (
            <LoadingText className="mt-6">Reading Ferry status on this device</LoadingText>
          )
        ) : status.lock === 'uninitialized' ? (
          <SetupScreen onDone={refresh} />
        ) : status.lock === 'locked' ? (
          <LockScreen autoLockMinutes={status.autoLockMinutes} onDone={refresh} />
        ) : status.account === null ? (
          <PairScreen status={status} onRefresh={refresh} />
        ) : (
          <Tabs
            items={TABS}
            value={tab}
            onValueChange={setTab}
            label="Ferry sections"
            className="pt-1"
          >
            <TabPanel value="now" className="pt-4">
              <NowTab status={status} site={site} onChanged={refresh} />
            </TabPanel>
            <TabPanel value="library" className="pt-4">
              <LibraryTab />
            </TabPanel>
            <TabPanel value="settings" className="pt-4">
              <SettingsTab site={site} status={status} onChanged={refresh} />
            </TabPanel>
          </Tabs>
        )}
      </main>
    </div>
  );
}
