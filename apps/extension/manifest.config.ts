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

export interface Origins {
  api: string;
  web: string;
}

const DEFAULT_ORIGIN = 'http://localhost:3000';

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

export function resolveOrigins(env: Record<string, string | undefined>): Origins {
  const api = parseOrigin(env.FERRY_API_ORIGIN ?? DEFAULT_ORIGIN, 'FERRY_API_ORIGIN');
  const web = parseOrigin(env.FERRY_WEB_ORIGIN ?? api, 'FERRY_WEB_ORIGIN');
  return { api, web };
}

export function hostPermissions(origins: Origins): string[] {
  return [...new Set([...FIXED_HOST_PERMISSIONS, `${origins.api}/*`])];
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
    permissions: [...PERMISSIONS],
    host_permissions: hostPermissions(origins),
    content_security_policy: { extension_pages: EXTENSION_PAGES_CSP },
    externally_connectable: { matches: [`${origins.web}/*`] },
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
