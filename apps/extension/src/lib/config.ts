import type { Site } from '@ferry/core';

export const FERRY_API_ORIGIN: string = __FERRY_API_ORIGIN__;
/** Exact origins whose pages may message the worker; the first is the one the panel links to. */
export const FERRY_WEB_ORIGINS: readonly string[] = Object.freeze([...__FERRY_WEB_ORIGINS__]);
export const FERRY_WEB_ORIGIN: string = FERRY_WEB_ORIGINS[0] ?? FERRY_API_ORIGIN;

export const RELAYER_URL = 'https://relayer.memory.walrus.xyz';
export const AGGREGATOR_URL = 'https://aggregator.walrus-mainnet.walrus.space';

/** Exact origins of the chat apps. Compared with `===` only (THREAT_MODEL X-MSG-1). */
export const SITE_BY_ORIGIN: Readonly<Record<string, Site>> = Object.freeze({
  'https://chatgpt.com': 'chatgpt',
  'https://claude.ai': 'claude',
  'https://gemini.google.com': 'gemini',
});

export const SITE_LABEL: Readonly<Record<Site, string>> = Object.freeze({
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
});

export const SITE_HOST: Readonly<Record<Site, string>> = Object.freeze({
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
});

/** Ferry API routes the extension depends on. Bodies are JSON and never contain the key. */
export const API_ROUTES = {
  account: (accountId: string) => `/api/chain/account/${accountId}`,
  blob: (blobId: string) => `/api/chain/blob/${encodeURIComponent(blobId)}`,
  distill: '/api/distill',
  judge: '/api/judge',
} as const;

export const AUTO_LOCK_CHOICES = [5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 30;
