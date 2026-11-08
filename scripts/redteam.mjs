#!/usr/bin/env node
// Runs the red-team suite (docs/REDTEAM.md): every vitest case whose title starts with an RT id, in
// every workspace package that has vitest tests, then prints the count. Fails if any RT case fails
// or if fewer than REDTEAM_MIN cases ran (default 25), so a silently skipped suite cannot pass CI.
/* global URL, process, console */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are this repo's own package dirs and a temp dir */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIN = Number(process.env.REDTEAM_MIN ?? 25);
const RT_TITLE = /\bRT-\d+/;
const CONCURRENCY = 4;

function packagesWithVitest() {
  const dirs = [];
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(ROOT, group))) {
      const dir = join(ROOT, group, name);
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const test = JSON.parse(readFileSync(manifest, 'utf8')).scripts?.test ?? '';
      if (test.includes('vitest')) dirs.push(dir);
    }
  }
  return dirs;
}

function run(dir, outputFile) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'vitest', 'run', '-t', 'RT-', '--passWithNoTests', '--reporter=json', `--outputFile=${outputFile}`], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, FERRY_SKIP_BIG: process.env.FERRY_SKIP_BIG ?? '1' },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

const work = mkdtempSync(join(tmpdir(), 'ferry-redteam-'));
const dirs = packagesWithVitest();
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < dirs.length) {
      const dir = dirs[next++];
      const outputFile = join(work, `${relative(ROOT, dir).replace(/\W/g, '_')}.json`);
      const { code, stderr } = await run(dir, outputFile);
      const report = existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, 'utf8')) : null;
      const cases = (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? []).filter((t) => RT_TITLE.test(t.title ?? t.fullName ?? ''));
      results.push({ pkg: relative(ROOT, dir), code, stderr, passed: cases.filter((t) => t.status === 'passed'), failed: cases.filter((t) => t.status === 'failed') });
    }
  }),
);
rmSync(work, { recursive: true, force: true });

results.sort((a, b) => a.pkg.localeCompare(b.pkg));
let passed = 0;
let failed = 0;
for (const r of results) {
  if (r.passed.length + r.failed.length === 0 && r.code === 0) continue;
  passed += r.passed.length;
  failed += r.failed.length;
  console.log(`${r.pkg}: ${r.passed.length} passed${r.failed.length ? `, ${r.failed.length} FAILED` : ''}`);
  for (const t of r.failed) console.log(`  FAILED ${t.fullName ?? t.title}`);
  if (r.code !== 0 && r.failed.length === 0) console.log(`  vitest exited ${r.code}:\n${r.stderr.split('\n').slice(-15).join('\n')}`);
}

const ids = new Set(results.flatMap((r) => r.passed.map((t) => RT_TITLE.exec(t.title ?? '')?.[0])).filter(Boolean));
console.log(`\nred team: ${passed} RT cases passed (${ids.size} distinct RT ids), ${failed} failed, minimum ${MIN}`);
const crashed = results.some((r) => r.code !== 0);
if (failed > 0 || crashed || passed < MIN) process.exit(1);
