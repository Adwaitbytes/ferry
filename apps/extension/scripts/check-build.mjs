#!/usr/bin/env node
// Post-build gate for the extension (RT-79, RT-38, RT-39, PRD 6.2): the built manifest must match
// the permission allowlist exactly, and no shipped file may contain eval, new Function or an
// innerHTML assignment. Run after `wxt build`; exits non-zero on any finding.
/* global URL, process, console */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are this package's fixed build output, never user input */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_PAGES_CSP,
  FONT_RESOURCE,
  PERMISSIONS,
  CHAT_HOSTS,
  EXTENSION_PUBLIC_KEY,
  connectableMatches,
  hostPermissions,
  resolveOrigins,
} from '../manifest.config.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.output', 'chrome-mv3');
const problems = [];
const fail = (msg) => problems.push(msg);

const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const origins = resolveOrigins(process.env);

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!sameSet(manifest.permissions ?? [], [...PERMISSIONS]))
  fail(
    `permissions ${JSON.stringify(manifest.permissions)} differ from allowlist ${JSON.stringify(PERMISSIONS)}`,
  );
if (manifest.optional_permissions !== undefined || manifest.optional_host_permissions !== undefined)
  fail('optional permissions are not allowed');
if (!sameSet(manifest.host_permissions ?? [], hostPermissions(origins)))
  fail(`host_permissions ${JSON.stringify(manifest.host_permissions)} differ from allowlist`);
for (const p of manifest.host_permissions ?? [])
  if (p === '<all_urls>' || p.startsWith('*://') || p.includes('://*'))
    fail(`wildcard host permission ${p}`);
if (manifest.content_security_policy?.extension_pages !== EXTENSION_PAGES_CSP)
  fail(`CSP is ${JSON.stringify(manifest.content_security_policy)}`);
if (!sameSet(manifest.externally_connectable?.matches ?? [], connectableMatches(origins)))
  fail('externally_connectable.matches must be exactly the Ferry web origins');
if (manifest.key !== EXTENSION_PUBLIC_KEY)
  fail('manifest key must be the pinned public key, or the extension id changes');
if (manifest.externally_connectable?.ids !== undefined)
  fail('externally_connectable.ids must not be set');
const war = manifest.web_accessible_resources ?? [];
if (
  war.length !== 1 ||
  !sameSet(war[0].resources, [FONT_RESOURCE]) ||
  !sameSet(
    war[0].matches,
    CHAT_HOSTS.map((h) => `${h}/*`),
  )
) {
  fail(
    `web_accessible_resources must expose only the font to the chat hosts: ${JSON.stringify(war)}`,
  );
}
for (const cs of manifest.content_scripts ?? []) {
  if (cs.all_frames === true) fail(`content script ${cs.js} runs in all frames`);
  if (cs.world === 'MAIN') fail(`content script ${cs.js} runs in the main world`);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const EVAL = /(?<![.\w$])eval\s*\(/;
const NEW_FUNCTION = /new\s+Function\s*\(/;
const INNER_HTML = /\.(?:inner|outer)HTML\s*=(?!=)/g;
const POST_MESSAGE = /\.postMessage\s*\(/;
const MESSAGE_LISTENER = /addEventListener\s*\(\s*["'`]message["'`]/;

const contentScripts = new Set((manifest.content_scripts ?? []).flatMap((cs) => cs.js));

for (const file of walk(OUT)) {
  if (!/\.(m?js|html)$/.test(file)) continue;
  const rel = relative(OUT, file);
  const text = readFileSync(file, 'utf8');
  if (EVAL.test(text)) fail(`${rel}: eval(`);
  if (NEW_FUNCTION.test(text)) fail(`${rel}: new Function(`);
  const sinks = [...text.matchAll(INNER_HTML)];
  // React DOM keeps two internal sinks: dangerouslySetInnerHTML (banned in our code by lint) and a
  // constant script shell. Only those exact shapes are tolerated, and only in extension page chunks.
  const unexpected = sinks.filter((m) => {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const after = text.slice(m.index, m.index + 40);
    const reactSink =
      rel.startsWith('chunks/') &&
      (/__html!==\w+&&\(\w+$/.test(before) || after.includes('`<script><\\/script>`'));
    return !reactSink;
  });
  if (unexpected.length > 0) fail(`${rel}: ${unexpected.length} innerHTML/outerHTML assignment(s)`);
  if (contentScripts.has(rel)) {
    if (POST_MESSAGE.test(text)) fail(`${rel}: content script calls postMessage`);
    if (MESSAGE_LISTENER.test(text)) fail(`${rel}: content script listens to window messages`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `check-build: ${p}`).join('\n'));
  process.exit(1);
}
console.log(
  `check-build: manifest allowlist and bundle scan clean (${contentScripts.size} content scripts)`,
);
