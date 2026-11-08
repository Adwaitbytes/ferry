/**
 * The manifest is built from one pure function so the build check and RT-79 can assert the exact
 * allowlist against the same source of truth the build uses.
 */

export const CHAT_HOSTS = [
  'https://chatgpt.com',
  'https://claude.ai',
  'https://gemini.google.com',
] as const;

export const FIXED_HOST_PERMISSIONS = [
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://relayer.memory.walrus.xyz/*',
  'https://aggregator.walrus-mainnet.walrus.space/*',
] as const;

export const PERMISSIONS = ['storage', 'sidePanel', 'alarms', 'idle'] as const;

export const EXTENSION_PAGES_CSP = "script-src 'self'; object-src 'none'";

export const FONT_RESOURCE = 'fonts/geist-latin-wght-normal.woff2';

/**
 * Public half of the signing key (base64 SPKI DER). Pinning it fixes the extension id for both
 * load-unpacked and the release ZIP, so the web app can hardcode NEXT_PUBLIC_FERRY_EXTENSION_ID.
 * The private key lives only at apps/extension/.extension-key.pem (gitignored).
 */
export const EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmC6SOvc9Taa9odXoTDI25JCVr/wQu5Y54YuSvhm42WU3qHLJQ0tHWYoQWq+Cn6bCSL/heGdXdzjohGfBa+CcdwXtBCZJapvE7pHfHLsXWsYZsko1Sq80sXhdjS+qD99P21Afik6QYd5cq8HEKg7885lmR6W4VRoab5XMJLZiNnYdRnPkxtHK8PWwh8GqOuw2CyNOSo2DHLorsgYkpcRKp5swy7P+Y6w4/2zVUAyBImW4QhRfySVAf1VRxhnvttkDugX5YqPo6+6mDyH6+jIFW7JCbE7dcFyTUXg31K6FAuTXiRp+PiL0pnm1SQsazWH3UD6NMRmDSajilzUhKNOEQQIDAQAB';

/** Chrome derives the id from the key: sha256 of the DER, first 32 hex digits mapped 0-f to a-p. */
export const EXTENSION_ID = 'opikbjojfgmdadhaljejplogjppfkhoh';

export interface Origins {
  /** Origin the worker calls for distill, judge and chain reads. */
  api: string;
  /** Exact web origins allowed to message the worker. The first is where the panel links to. */
  web: string[];
}

export const LOCAL_WEB_ORIGIN = 'http://localhost:3000';

/** Accepts only a bare origin. Plain http is allowed for localhost development and nowhere else. */
export function parseOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.origin !== value)
    throw new Error(`${name} must be a bare origin such as https://ferry.example`);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} must use https outside localhost`);
  }
  return url.origin;
}

const optionalOrigin = (value: string | undefined, name: string): string | null =>
  value === undefined || value === '' ? null : parseOrigin(value, name);

/**
 * One build serves local development and production: the web app on localhost:3000 and the
 * production origin (FERRY_WEB_ORIGIN_PROD, https only) may both talk to the worker. The API
 * defaults to production when it is configured, so a release ZIP never calls localhost.
 */
export function resolveOrigins(env: Record<string, string | undefined>): Origins {
  const prod = optionalOrigin(env.FERRY_WEB_ORIGIN_PROD, 'FERRY_WEB_ORIGIN_PROD');
  if (prod !== null && !prod.startsWith('https://'))
    throw new Error('FERRY_WEB_ORIGIN_PROD must use https');
  const extra = optionalOrigin(env.FERRY_WEB_ORIGIN, 'FERRY_WEB_ORIGIN');
  const api = parseOrigin(env.FERRY_API_ORIGIN ?? prod ?? LOCAL_WEB_ORIGIN, 'FERRY_API_ORIGIN');
  // A release build must not trust whatever happens to serve localhost:3000 on a user's machine.
  const local = env.FERRY_RELEASE === '1' ? null : LOCAL_WEB_ORIGIN;
  if (env.FERRY_RELEASE === '1' && prod === null) throw new Error('FERRY_RELEASE=1 requires FERRY_WEB_ORIGIN_PROD');
  const web = [...new Set([prod, extra, local].filter((o): o is string => o !== null))];
  return { api, web };
}

export function apiOrigins(origins: Origins): string[] {
  return [...new Set([origins.api, ...origins.web])];
}

export function hostPermissions(origins: Origins): string[] {
  return [...new Set([...FIXED_HOST_PERMISSIONS, ...apiOrigins(origins).map((o) => `${o}/*`)])];
}

export function connectableMatches(origins: Origins): string[] {
  return origins.web.map((o) => `${o}/*`);
}

const contentScript = (host: string, name: string) => ({
  matches: [`${host}/*`],
  js: [`${name}.js`],
  run_at: 'document_idle' as const,
  // Frames inside a chat site (ads, embeds) must never be able to talk to the worker (RT-38).
  all_frames: false,
});

export function buildManifest(origins: Origins) {
  return {
    name: 'Ferry',
    description: 'One memory you own, carried across ChatGPT, Claude and Gemini. Stored on Walrus.',
    minimum_chrome_version: '116',
    key: EXTENSION_PUBLIC_KEY,
    permissions: [...PERMISSIONS],
    host_permissions: hostPermissions(origins),
    content_security_policy: { extension_pages: EXTENSION_PAGES_CSP },
    externally_connectable: { matches: connectableMatches(origins) },
    web_accessible_resources: [
      { resources: [FONT_RESOURCE], matches: CHAT_HOSTS.map((h) => `${h}/*`) },
    ],
    action: { default_title: 'Open Ferry' },
    content_scripts: [
      contentScript('https://chatgpt.com', 'content-chatgpt'),
      contentScript('https://claude.ai', 'content-claude'),
      contentScript('https://gemini.google.com', 'content-gemini'),
    ],
    commands: {
      'open-side-panel': {
        suggested_key: { default: 'Alt+F' },
        description: 'Open the Ferry side panel',
      },
      'insert-context': {
        suggested_key: { default: 'Alt+I' },
        description: 'Insert suggested Ferry context',
      },
    },
  };
}
