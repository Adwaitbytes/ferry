/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths';

/** Self-signed certificate for the chat hosts, used only by the local fixture server. */
export function ensureTlsCert(): { key: string; cert: string } {
  if (!existsSync(paths.tlsCert) || !existsSync(paths.tlsKey)) {
    mkdirSync(dirname(paths.tlsCert), { recursive: true });
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
        '-keyout', paths.tlsKey, '-out', paths.tlsCert,
        '-subj', '/CN=ferry-e2e',
        '-addext', 'subjectAltName=DNS:chatgpt.com,DNS:claude.ai,DNS:gemini.google.com',
      ],
      { stdio: 'ignore' },
    );
  }
  return { key: paths.tlsKey, cert: paths.tlsCert };
}
