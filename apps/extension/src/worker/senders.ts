import type { Site } from '@ferry/core';
import { SITE_BY_ORIGIN } from '../lib/config';

/** The subset of `chrome.runtime.MessageSender` the worker trusts. Structural so tests can forge it. */
export interface SenderLike {
  id?: string | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined; url?: string | undefined } | undefined;
}

export type SenderClass =
  | { kind: 'content'; site: Site; tabId: number }
  | { kind: 'extension_page' }
  | { kind: 'web_app' }
  | { kind: 'forbidden' };

const FORBIDDEN: SenderClass = { kind: 'forbidden' };

/** WHATWG origin, or null for anything unparsable. Never `startsWith` or regex on hosts (X-MSG-1). */
export function originOf(url: string | undefined): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `chrome-extension:` is not a WHATWG special scheme, so `URL.origin` is "null" outside Chrome.
 * Compare scheme and host instead, which is exact in every runtime.
 */
function isOwnExtensionUrl(url: string | undefined, extensionId: string): boolean {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' && parsed.host === extensionId;
  } catch {
    return false;
  }
}

/** Messages from `runtime.onMessage`: content scripts on the three chat hosts, or our own pages. */
export function classifyInternal(sender: SenderLike, extensionId: string): SenderClass {
  if (sender.id !== extensionId) return FORBIDDEN;

  if (sender.tab !== undefined) {
    if (sender.frameId !== 0) return FORBIDDEN;
    const tabOrigin = originOf(sender.tab.url);
    if (tabOrigin === null) return FORBIDDEN;
    const site = SITE_BY_ORIGIN[tabOrigin];
    if (site === undefined) return FORBIDDEN;
    // The top frame's own URL must agree with the tab, so a navigation race cannot borrow a site.
    if (sender.url !== undefined && originOf(sender.url) !== tabOrigin) return FORBIDDEN;
    if (sender.origin !== undefined && sender.origin !== tabOrigin) return FORBIDDEN;
    const tabId = sender.tab.id;
    if (typeof tabId !== 'number' || tabId < 0) return FORBIDDEN;
    return { kind: 'content', site, tabId };
  }

  if (isOwnExtensionUrl(sender.url, extensionId)) return { kind: 'extension_page' };
  return FORBIDDEN;
}

/** Messages from `runtime.onMessageExternal`: only the exact Ferry web origin. */
export function classifyExternal(sender: SenderLike, webOrigin: string): SenderClass {
  if (typeof sender.origin !== 'string' || sender.origin !== webOrigin) return FORBIDDEN;
  if (sender.url !== undefined && originOf(sender.url) !== webOrigin) return FORBIDDEN;
  return { kind: 'web_app' };
}
