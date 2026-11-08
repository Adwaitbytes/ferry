import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const E2E_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_DIR = join(E2E_DIR, '..');
export const CACHE_DIR = join(E2E_DIR, '.cache');

export const paths = {
  fakeExtensionBundle: join(CACHE_DIR, 'fake-extension.js'),
  mockWalletBundle: join(CACHE_DIR, 'mock-wallet.js'),
  walletFixture: join(CACHE_DIR, 'wallet.json'),
  chatgptZip: join(CACHE_DIR, 'chatgpt-export.zip'),
  tlsKey: join(CACHE_DIR, 'tls', 'key.pem'),
  tlsCert: join(CACHE_DIR, 'tls', 'cert.pem'),
  extensionOutput: join(REPO_DIR, 'apps', 'extension', '.output', 'chrome-mv3'),
  adapterFixtures: join(REPO_DIR, 'packages', 'adapters', 'fixtures'),
  importerFixtures: join(REPO_DIR, 'packages', 'importers', 'fixtures'),
} as const;
