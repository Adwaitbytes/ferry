/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import { installMocks, type MockLog, type MockOptions } from './mocks';
import { paths } from './paths';
import { E2E_EXTENSION_ID, STORAGE, WEB_ORIGIN, type E2EConfig, type ExtensionLogEntry, type ExtensionSeed, type WalletLogEntry } from './protocol';
import type { MockWalletFixture } from './sui-fixture';

export interface FerrySetup extends MockOptions {
  extension?: ExtensionSeed | null;
  wallet?: boolean;
  theme?: 'light' | 'dark';
}

export interface Ferry {
  /** Installs the fake extension, the CI mock wallet and the network mocks. Call before `goto`. */
  setup(options?: FerrySetup): Promise<MockLog>;
  wallet: MockWalletFixture;
  extensionLog(): Promise<ExtensionLogEntry[]>;
  walletLog(): Promise<WalletLogEntry[]>;
  /** Fails on any serious or critical axe violation on the current screen. */
  expectAccessible(label: string): Promise<void>;
}

const fakeExtension = (): string => readFileSync(paths.fakeExtensionBundle, 'utf8');
const mockWallet = (): string => readFileSync(paths.mockWalletBundle, 'utf8');

async function readLog<T>(page: Page, key: string): Promise<T[]> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as unknown, key) as Promise<T[]>;
}

export const test = base.extend<{ ferry: Ferry }>({
  ferry: async ({ page }, use, testInfo) => {
    const wallet = JSON.parse(readFileSync(paths.walletFixture, 'utf8')) as MockWalletFixture;
    let log: MockLog | null = null;

    const ferry: Ferry = {
      wallet,
      async setup(options = {}) {
        const config: E2EConfig = {
          extensionId: E2E_EXTENSION_ID,
          extension: options.extension ?? {
            hasVault: false,
            locked: true,
            paired: false,
            accountId: null,
            owner: null,
            publicKeyHex: '00'.repeat(32),
            items: [],
            writesPerPoll: 1,
          },
          wallet: options.wallet ? wallet : null,
        };
        const theme = options.theme ?? 'light';
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        // The web app reads the theme from a cookie so the server paints it with no inline script.
        await page.context().addCookies([{ name: 'ferry-theme', value: theme, url: WEB_ORIGIN }]);
        await page.addInitScript((cfg) => {
          Reflect.set(window, '__FERRY_E2E_CONFIG__', cfg);
          // Same switch the web app sets before its bundles: the CSP forbids eval, so every zod copy
          // (the fake extension bundles its own) must skip its compiled fast path.
          Reflect.set(globalThis, '__zod_globalConfig', { ...(Reflect.get(globalThis, '__zod_globalConfig') as object | undefined), jitless: true });
        }, config);
        if (options.extension !== null) await page.addInitScript({ content: fakeExtension() });
        if (options.wallet) await page.addInitScript({ content: mockWallet() });
        log = await installMocks(page, options);
        return log;
      },
      extensionLog: () => readLog<ExtensionLogEntry>(page, STORAGE.extensionLog),
      walletLog: () => readLog<WalletLogEntry>(page, STORAGE.walletLog),
      async expectAccessible(label) {
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        await testInfo.attach(`axe-${label}.json`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
        expect(
          blocking.map((v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`),
          `axe on ${label}`,
        ).toEqual([]);
      },
    };

    await use(ferry);

    if (log !== null) {
      const final: MockLog = log;
      expect(final.contractViolations, 'requests that broke a @ferry/core contract').toEqual([]);
      const entries = await ferry.extensionLog().catch(() => []);
      expect(entries.filter((entry) => !entry.valid), 'WebAppRequests the fake extension rejected as malformed').toEqual([]);
      expect(entries.filter((entry) => entry.error !== undefined), 'replies that broke the WebAppResponse contract').toEqual([]);
    }
  },
});

export { expect };
