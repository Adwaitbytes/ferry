import type { LibraryItem } from '@ferry/core';
import type { MockWalletFixture } from './sui-fixture';

/** Matches `^[a-p]{32}$`, the Chrome extension id shape the web app accepts at build time. */
export const E2E_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const WEB_PORT = 3210;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** Gate origin baked into the e2e web build. Never resolved: every request to it is routed in the browser. */
export const MOCK_GATE_ORIGIN = 'https://gate.ferry.test';
/** The real Gate app, run locally on PGlite through its own test rig (servers/gate-server.ts). */
export const GATE_PORT = 3211;
export const GATE_CONTROL_PORT = 3212;
/** HTTPS server for the chat site DOM fixtures; Chromium maps chatgpt.com and claude.ai here. */
export const CHAT_SITES_PORT = 8443;

export const ACCOUNT_ID = `0x${'e1'.repeat(32)}`;
export const DEVICE_PUBLIC_KEY_HEX = `5a17${'0f'.repeat(28)}c0de`;

/** Storage keys the in-page fakes persist under, so state survives client navigation and reloads. */
export const STORAGE = {
  extension: 'ferry-e2e:extension',
  extensionLog: 'ferry-e2e:extension-log',
  walletLog: 'ferry-e2e:wallet-log',
} as const;

export interface ExtensionSeed {
  hasVault: boolean;
  locked: boolean;
  paired: boolean;
  accountId: string | null;
  owner: string | null;
  publicKeyHex: string;
  items: LibraryItem[];
  /** Facts the fake writes per `import.progress` poll, so the write progress is observable. */
  writesPerPoll: number;
}

export interface E2EConfig {
  extensionId: string;
  extension: ExtensionSeed;
  wallet: MockWalletFixture | null;
}

export interface ExtensionLogEntry {
  type: string;
  valid: boolean;
  ok: boolean;
  /** Set when the fake itself failed (for example a reply that broke the response contract). */
  error?: string;
}

export interface WalletLogEntry {
  feature: string;
  /** Serialized transaction JSON the dApp handed to the wallet, when it could be read. */
  transaction: string | null;
}
