import { defineConfig, devices } from '@playwright/test';
import { CHAT_SITES_PORT, GATE_CONTROL_PORT, WEB_ORIGIN, WEB_PORT } from './support/protocol';
import { REPO_DIR } from './support/paths';
import { join } from 'node:path';

const CI = process.env.CI === 'true';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'web',
      testIgnore: /extension\..*spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      // The real built extension in a persistent context; the spec launches its own browser.
      name: 'extension',
      testMatch: /extension\..*spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'pnpm exec next start --port 3210',
      cwd: join(REPO_DIR, 'apps', 'web'),
      url: `${WEB_ORIGIN}/api/stats`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: {
        FERRY_NEXT_DIST_DIR: '.next-e2e',
        NEXT_TELEMETRY_DISABLED: '1',
        PORT: String(WEB_PORT),
      },
    },
    {
      command: 'pnpm exec tsx servers/gate-server.ts',
      url: `http://127.0.0.1:${GATE_CONTROL_PORT}/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec tsx servers/chat-sites.ts',
      url: `https://127.0.0.1:${CHAT_SITES_PORT}/__health`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
