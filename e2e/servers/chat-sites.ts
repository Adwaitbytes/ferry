/*
 * Serves the saved chat-site DOM snapshots (packages/adapters/fixtures) over HTTPS. Chromium maps
 * chatgpt.com, claude.ai and gemini.google.com to this server with --host-resolver-rules, so the
 * real extension's content scripts match and run against real hostnames, fully offline.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { paths } from '../support/paths';
import { CHAT_SITES_PORT } from '../support/protocol';
import { ensureTlsCert } from '../support/tls';

const SITES: Record<string, string> = { 'chatgpt.com': 'chatgpt', 'claude.ai': 'claude', 'gemini.google.com': 'gemini' };

function page(host: string, pathname: string): string | null {
  const site = SITES[host];
  if (site === undefined) return null;
  const name = pathname === '/' || pathname === '/new' || pathname === '/app' ? 'new-chat.html' : 'conversation.html';
  return readFileSync(join(paths.adapterFixtures, site, name), 'utf8');
}

const tls = ensureTlsCert();
const server = createServer({ key: readFileSync(tls.key), cert: readFileSync(tls.cert) }, (req, res) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  const url = new URL(req.url ?? '/', `https://${host}`);
  if (url.pathname === '/__health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  const body = page(host, url.pathname);
  if (body === null) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('unknown host');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
});

server.listen(CHAT_SITES_PORT, '127.0.0.1');
