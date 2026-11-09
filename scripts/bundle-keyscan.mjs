#!/usr/bin/env node
// Fails if any client bundle contains a secret: either a known key shape, or the literal
// value of any server secret present in the environment or .env.local (PRD 6.2).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BUNDLE_DIRS = ['apps/web/.next/static', 'apps/extension/.output', 'packages/sdk/dist'];
const SECRET_VARS = [
  'TATUM_API_KEY', 'GATE_DELEGATE_PRIVATE_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'UPSTASH_REDIS_REST_TOKEN', 'ENOKI_API_KEY', 'SESSION_SECRET',
];
const SHAPES = [
  ['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai key', /sk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ['openrouter key', /sk-or-v1-[a-f0-9]{32,}/],
  ['google api key', /AIza[0-9A-Za-z_-]{35}/],
  ['sui private key', /suiprivkey1[0-9a-z]{50,}/],
  ['postgres url', /postgres(ql)?:\/\/[^\s"']+:[^\s"']+@/],
  ['pem private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['tatum key', /\bt-[0-9a-f]{24}-[0-9a-f]{20,40}\b/],
];

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n')
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  );
}
const env = { ...loadEnvFile(join(ROOT, '.env.local')), ...process.env };
const literals = SECRET_VARS.map((k) => [k, env[k]]).filter(([, v]) => typeof v === 'string' && v.length >= 12);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs|html|json|css|map|txt)$/.test(name)) yield full;
  }
}

const hits = [];
let scanned = 0;
for (const d of BUNDLE_DIRS) {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    scanned++;
    const body = readFileSync(file, 'utf8');
    for (const [name, re] of SHAPES) if (re.test(body)) hits.push(`${relative(ROOT, file)}: ${name}`);
    for (const [name, value] of literals) if (body.includes(value)) hits.push(`${relative(ROOT, file)}: value of ${name}`);
  }
}
if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`bundle-keyscan: ${scanned} files clean, ${literals.length} secret values checked`);
