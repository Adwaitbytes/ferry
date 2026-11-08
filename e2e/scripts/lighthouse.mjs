#!/usr/bin/env node
// Lighthouse on the landing page served by `next start` (the e2e production build), with the
// Playwright Chromium. Prints accessibility and performance for mobile (default throttling) and
// desktop, plus the largest performance opportunities, and writes JSON reports to lighthouse-report/.
/* global URL, process, console, fetch, setTimeout */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are this package's own report dir */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(E2E, '..', 'apps', 'web');
const OUT = join(E2E, 'lighthouse-report');
const PORT = 3220;
const URL_UNDER_TEST = `http://localhost:${PORT}/`;

mkdirSync(OUT, { recursive: true });
const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  cwd: WEB,
  stdio: 'ignore',
  env: { ...process.env, FERRY_NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' },
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_UNDER_TEST)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('next start did not come up');
}

function audit(name, extra) {
  const output = join(OUT, `landing-${name}.json`);
  const result = spawnSync(
    'pnpm',
    [
      'exec', 'lighthouse', URL_UNDER_TEST,
      '--only-categories=performance,accessibility',
      '--output=json', `--output-path=${output}`, '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
      ...extra,
    ],
    { cwd: E2E, stdio: 'inherit', env: { ...process.env, CHROME_PATH: chromium.executablePath() } },
  );
  if (result.status !== 0) throw new Error(`lighthouse ${name} failed`);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
  const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']
    .map((id) => `${id} ${report.audits[id]?.displayValue ?? 'n/a'}`)
    .join(', ');
  const opportunities = Object.values(report.audits)
    .filter((a) => a.details?.type === 'opportunity' && (a.details.overallSavingsMs ?? 0) > 50)
    .sort((a, b) => (b.details.overallSavingsMs ?? 0) - (a.details.overallSavingsMs ?? 0))
    .slice(0, 5)
    .map((a) => `${a.title} (${Math.round(a.details.overallSavingsMs)} ms)`);
  const failedA11y = report.categories.accessibility.auditRefs
    .filter((ref) => ref.weight > 0 && report.audits[ref.id]?.score === 0)
    .map((ref) => ref.id);
  console.log(`${name}: accessibility ${score('accessibility')}, performance ${score('performance')}`);
  console.log(`  ${metrics}`);
  if (opportunities.length > 0) console.log(`  opportunities: ${opportunities.join('; ')}`);
  if (failedA11y.length > 0) console.log(`  failed accessibility audits: ${failedA11y.join(', ')}`);
}

try {
  await waitForServer();
  audit('mobile', []);
  audit('desktop', ['--preset=desktop']);
} finally {
  server.kill();
}
