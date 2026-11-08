/**
 * Public configuration. `NEXT_PUBLIC_*` values are inlined at build time, so each is read with a
 * literal property access. Nothing secret lives here.
 */
/** Fixed by the `key` in apps/extension/manifest.config.ts; override only for a fork with its own key. */
export const DEFAULT_EXTENSION_ID = 'opikbjojfgmdadhaljejplogjppfkhoh';
const configuredExtensionId = process.env.NEXT_PUBLIC_FERRY_EXTENSION_ID ?? '';
const extensionId = configuredExtensionId === '' ? DEFAULT_EXTENSION_ID : configuredExtensionId;
const gateUrl = process.env.NEXT_PUBLIC_GATE_URL ?? '';

export const publicEnv = {
  /** Chrome extension id the web app messages through `externally_connectable`. */
  extensionId: /^[a-p]{32}$/.test(extensionId) ? extensionId : null,
  /** Ferry Gate origin for the earnings API, without a trailing slash. */
  gateUrl: gateUrl.replace(/\/+$/, '') || null,
  releaseUrl: process.env.NEXT_PUBLIC_RELEASE_URL ?? 'https://github.com/Adwaitbytes/ferry/releases/latest',
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/Adwaitbytes/ferry',
  demoVideoUrl: process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? null,
  aggregatorUrl: process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-mainnet.walrus.space',
} as const;

export const SUI_FULLNODE_URL = 'https://fullnode.mainnet.sui.io:443';
