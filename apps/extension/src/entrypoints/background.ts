import { toMarkdown, toPam } from '@ferry/importers';
import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { z } from 'zod';
import { FERRY_API_ORIGIN, FERRY_WEB_ORIGINS } from '../lib/config';
import { IMPORT_PORT, type WorkerToContent } from '../lib/protocol';
import { createFerryApi } from '../worker/api';
import { chromeArea, wipeIndexedDb } from '../worker/chrome-storage';
import { memwalCrypto, memwalEngines } from '../worker/engine-memwal';
import { FerryWorker } from '../worker/service';
import { SETTINGS_KEY } from '../worker/settings';

// The extension CSP forbids eval; tell zod up front instead of letting it probe and log violations.
z.config({ jitless: true });

const AUTO_LOCK_ALARM = 'ferry.autolock';
/** chrome.idle accepts 15 s to 4 h. */
const clampIdleSeconds = (minutes: number) =>
  Math.min(14_400, Math.max(15, Math.round(minutes * 60)));

function deviceLabel(): string {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `Ferry on Chrome ${date}`.slice(0, 64);
}

export default defineBackground({
  main() {
    const api = createFerryApi(FERRY_API_ORIGIN);
    const worker = new FerryWorker({
      extensionId: browser.runtime.id,
      webOrigins: FERRY_WEB_ORIGINS,
      local: chromeArea(browser.storage.local),
      session: chromeArea(browser.storage.session),
      crypto: memwalCrypto,
      api,
      engines: memwalEngines(api),
      clock: { now: () => Date.now() },
      exporter: {
        toJson: async (memories) => JSON.stringify(await toPam(memories), null, 2),
        toMarkdown: (memories) => toMarkdown(memories),
      },
      newId: () => crypto.randomUUID(),
      openSidePanel: async (tabId) => {
        await browser.sidePanel.open({ tabId });
      },
      sendToTab: (tabId, message) => browser.tabs.sendMessage(tabId, message),
      wipeIndexedDb,
      deviceLabel,
    });

    // Session storage holds the open seed; content scripts must never be able to read it.
    void browser.storage.session
      .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
      .then(() => worker.vault.restore());
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    // Listeners are registered synchronously so a cold-started worker never drops the waking event.
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      void worker.route(message, sender, 'internal').then(sendResponse);
      return true;
    });
    browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
      void worker.route(message, sender, 'external').then(sendResponse);
      return true;
    });

    const watchImports = (port: Browser.runtime.Port, channel: 'internal' | 'external') => {
      if (
        port.name !== IMPORT_PORT ||
        port.sender === undefined ||
        !worker.mayWatchImports(port.sender, channel)
      ) {
        port.disconnect();
        return;
      }
      const stop = worker.onImportProgress((progress) => port.postMessage(progress));
      port.onDisconnect.addListener(stop);
    };
    browser.runtime.onConnect.addListener((port) => watchImports(port, 'internal'));
    browser.runtime.onConnectExternal.addListener((port) => watchImports(port, 'external'));

    const applyIdleInterval = async () => {
      const { autoLockMinutes } = await worker.settings.get();
      browser.idle.setDetectionInterval(clampIdleSeconds(autoLockMinutes));
    };
    void applyIdleInterval();
    browser.idle.onStateChanged.addListener((state) => {
      if (state === 'idle' || state === 'locked') void worker.vault.lock();
    });
    // Backup for the idle API: the vault re-checks its own idle deadline on every tick.
    void browser.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: 1 });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === AUTO_LOCK_ALARM) void worker.vault.state();
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SETTINGS_KEY in changes) {
        worker.settings.reset();
        void applyIdleInterval();
      }
    });

    browser.commands.onCommand.addListener((command, tab) => {
      if (command === 'open-side-panel' && tab?.windowId !== undefined) {
        void browser.sidePanel.open({ windowId: tab.windowId });
      }
      if (command === 'insert-context' && tab?.id !== undefined) {
        const message: WorkerToContent = { type: 'ferry.insert-suggested' };
        // Tabs without a Ferry content script reject; that is expected and harmless.
        browser.tabs.sendMessage(tab.id, message).catch(() => undefined);
      }
    });
    browser.tabs.onRemoved.addListener((tabId) => worker.forgetTab(tabId));
  },
});
