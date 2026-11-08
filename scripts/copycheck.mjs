#!/usr/bin/env node
// Enforces PRD section 8 on everything a human reads: no em or en dashes, no banned words.
// Regions between "copycheck:off" and "copycheck:on" markers are skipped (used where the
// rules themselves are quoted, such as the banned word list in DESIGN.md).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.output', '.wxt', 'dist', 'coverage', '.turbo', 'fixtures', 'test-results', 'playwright-report', 'private-data']);
const SKIP_FILES = new Set(['docs/PRD.md', 'scripts/copycheck.mjs', 'pnpm-lock.yaml']);
const COPY_EXT = new Set(['.md', '.mdx', '.tsx', '.html', '.txt']);
const DASH_EXT = new Set([...COPY_EXT, '.ts', '.mjs', '.js', '.json', '.css', '.yml', '.yaml']);

const BANNED = [
  'seamless', 'seamlessly', 'leverage', 'leverages', 'leveraging', 'unlock', 'unlocks', 'unlocking',
  'empower', 'empowers', 'empowering', 'revolutionize', 'revolutionizes', 'revolutionary',
  'game changer', 'game-changer', 'game changing', 'cutting edge', 'cutting-edge', 'delve', 'delves',
  'robust', 'elevate', 'elevates', 'harness', 'harnesses', 'supercharge', 'supercharged',
  'next generation', 'next-generation', 'journey', "in today's world", "let's dive in",
];
const bannedRe = new RegExp(`\\b(${BANNED.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const notJustRe = /\bit'?s not just\b[^.]*,\s*it'?s\b/i;
const dashRe = /[–—]/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const problems = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  const ext = extname(file);
  if (SKIP_FILES.has(rel) || !DASH_EXT.has(ext)) continue;
  let off = false;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('copycheck:off')) off = true;
    if (line.includes('copycheck:on')) { off = false; return; }
    if (off) return;
    if (dashRe.test(line)) problems.push(`${rel}:${i + 1} em or en dash`);
    if (COPY_EXT.has(ext)) {
      const m = bannedRe.exec(line);
      if (m) problems.push(`${rel}:${i + 1} banned word "${m[1]}"`);
      if (notJustRe.test(line)) problems.push(`${rel}:${i + 1} banned construction "it's not just X, it's Y"`);
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\ncopycheck: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('copycheck: clean');
