#!/usr/bin/env node
// Builds apps/web for e2e into apps/web/.next-e2e with test-only public env: a fake extension id
// (answered by the in-page fake) and a Gate origin the browser mocks. The real .next is untouched.
// With --if-stale it skips the build when the output is newer than every web and package source.
/* global URL, process, console */
/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const WEB = join(REPO, 'apps', 'web');
const OUT = join(WEB, '.next-e2e');
const BUILD_ID = join(OUT, 'BUILD_ID');

export const E2E_WEB_ENV = {
  FERRY_NEXT_DIST_DIR: '.next-e2e',
  NEXT_PUBLIC_FERRY_EXTENSION_ID: 'abcdefghijklmnopabcdefghijklmnop',
  NEXT_PUBLIC_GATE_URL: 'https://gate.ferry.test',
  NEXT_PUBLIC_RELEASE_URL: 'https://github.com/Adwaitbytes/ferry/releases/latest',
  NEXT_TELEMETRY_DISABLED: '1',
};

function newestMtime(dir) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next')) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    newest = Math.max(newest, stat.isDirectory() ? newestMtime(full) : stat.mtimeMs);
  }
  return newest;
}

function isStale() {
  if (!existsSync(BUILD_ID)) return true;
  const built = statSync(BUILD_ID).mtimeMs;
  const sources = [join(WEB, 'src'), join(WEB, 'next.config.ts'), ...readdirSync(join(REPO, 'packages')).map((p) => join(REPO, 'packages', p, 'src'))];
  return sources.some((source) => existsSync(source) && (statSync(source).isDirectory() ? newestMtime(source) : statSync(source).mtimeMs) > built);
}

if (process.argv.includes('--if-stale') && (process.env.E2E_SKIP_BUILD === '1' || !isStale())) {
  console.log('e2e web build is up to date');
  process.exit(0);
}

const started = Date.now();
const result = spawnSync('pnpm', ['exec', 'next', 'build', '--webpack'], { cwd: WEB, stdio: 'inherit', env: { ...process.env, ...E2E_WEB_ENV } });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`e2e web build done in ${Math.round((Date.now() - started) / 1000)}s`);
