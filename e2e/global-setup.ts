/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { E2E_DIR, CACHE_DIR, paths } from './support/paths';
import { buildMockWalletFixture } from './support/sui-fixture';

async function bundle(entry: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [join(E2E_DIR, 'support', 'browser', entry)],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    logLevel: 'warning',
  });
}

/** A real ChatGPT export ZIP, assembled from the anonymized importer fixtures. */
function buildChatGptZip(): void {
  const dir = join(paths.importerFixtures, 'chatgpt');
  const files: Record<string, Uint8Array> = {};
  for (const name of readdirSync(dir)) files[name] = readFileSync(join(dir, name));
  writeFileSync(paths.chatgptZip, zipSync(files));
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  await bundle('fake-extension.ts', paths.fakeExtensionBundle);
  await bundle('mock-wallet.ts', paths.mockWalletBundle);
  writeFileSync(paths.walletFixture, JSON.stringify(await buildMockWalletFixture()));
  buildChatGptZip();
}
