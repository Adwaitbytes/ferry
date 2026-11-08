/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { existsSync } from 'node:fs';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { paths } from '../support/paths';
import { CHAT_SITES_PORT } from '../support/protocol';

/*
 * Carry, extension side: the real built MV3 extension (apps/extension/.output/chrome-mv3) in
 * Chromium's new headless mode, on the saved chat-site DOM snapshots served over HTTPS with the real
 * hostnames mapped to localhost. Covered: content scripts match and run the real adapters, typing in
 * the composer reaches the worker (recall.suggest) and the chip renders in a closed shadow root,
 * pages cannot reach Ferry's UI or the worker, and an extension page opened as a tab is refused.
 * Not covered in CI: a full save on ChatGPT then recall on Claude, which needs an unlocked vault,
 * a paired Walrus Memory account and the live relayer; the side panel UI itself, which headless
 * Chromium cannot open without a user gesture. Both are the manual LIVE_SMOKE run before freeze.
 */

interface AxNode {
  role?: { value?: string };
  name?: { value?: string };
}

interface ChromeLike {
  runtime: { getManifest(): Manifest; sendMessage(message: unknown): Promise<unknown> };
}

interface Manifest {
  manifest_version: number;
  content_scripts?: { matches?: string[] }[];
}

interface WorkerReply {
  ok: boolean;
  code?: string;
}

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let extensionId = '';

test.skip(!existsSync(paths.extensionOutput), 'Build the extension first: pnpm --filter @ferry/extension build');

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${paths.extensionOutput}`,
      `--load-extension=${paths.extensionOutput}`,
      `--host-resolver-rules=MAP chatgpt.com 127.0.0.1:${CHAT_SITES_PORT}, MAP claude.ai 127.0.0.1:${CHAT_SITES_PORT}, MAP gemini.google.com 127.0.0.1:${CHAT_SITES_PORT}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context.close();
});

/** Reads the accessibility tree through CDP, which includes closed shadow roots page scripts cannot see. */
async function axNames(page: Page): Promise<string[]> {
  const cdp = await context.newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] };
  await cdp.detach();
  return nodes.map((n) => `${n.role?.value ?? ''}: ${n.name?.value ?? ''}`);
}

test('the MV3 manifest loads with exactly the three chat hosts for content scripts', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const manifest = (await worker?.evaluate(() => (Reflect.get(globalThis, 'chrome') as ChromeLike).runtime.getManifest())) as Manifest;
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.content_scripts?.flatMap((c) => c.matches ?? [])).toEqual(['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*']);
});

for (const site of [
  { name: 'chatgpt', url: 'https://chatgpt.com/', composer: '#prompt-textarea' },
  { name: 'claude', url: 'https://claude.ai/new', composer: 'div[contenteditable="true"]' },
] as const) {
  test(`${site.name}: the content script finds the composer and offers the chip, inside a closed shadow root`, async () => {
    const page = await context.newPage();
    await page.goto(site.url);

    await page.locator(site.composer).first().click();
    await page.keyboard.type('Plan dinner for Friday with my partner');

    // No vault yet, so the worker answers recall with "locked" and the chip says so.
    await expect
      .poll(async () => (await axNames(page)).some((n) => n.startsWith('button: Ferry is locked. Open the side panel to continue.')), { timeout: 15_000 })
      .toBe(true);

    const isolation = await page.evaluate(() => {
      const host = document.querySelector('ferry-ui');
      return { mounted: host !== null, shadowVisibleToPage: host?.shadowRoot !== null && host?.shadowRoot !== undefined };
    });
    expect(isolation).toEqual({ mounted: true, shadowVisibleToPage: false });
    await page.close();
  });
}

test('a web page cannot message the extension worker', async () => {
  const page = await context.newPage();
  await page.goto('https://chatgpt.com/');
  const reachable = await page.evaluate((id) => {
    const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime;
    return typeof runtime?.sendMessage === 'function' ? id : null;
  }, extensionId);
  // chatgpt.com is not in externally_connectable, so the page has no runtime messaging at all.
  expect(reachable).toBeNull();
  await page.close();
});

test('an extension page opened as a tab cannot impersonate the side panel', async () => {
  const tab = await context.newPage();
  await tab.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // The worker classifies senders from chrome's sender object: a page inside a tab is never the panel.
  const reply = (await tab.evaluate(() => (Reflect.get(globalThis, 'chrome') as ChromeLike).runtime.sendMessage({ type: 'status.get' }))) as WorkerReply;
  expect(reply).toMatchObject({ ok: false, code: 'forbidden_sender' });
  await tab.close();
});
