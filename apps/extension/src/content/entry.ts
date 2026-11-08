import { adapterFor } from '@ferry/adapters';
import type { Site } from '@ferry/core';
import tokens from '@ferry/ui/tokens.css?inline';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { WorkerToContent } from '../lib/protocol';
import contentCss from './content.css?inline';
import { startFerry } from './controller';

/** Shared body of the three per-site content scripts. */
export function runContent(site: Site): void {
  z.config({ jitless: true });
  // Only the top frame of the exact chat origin runs Ferry; the manifest already sets all_frames false.
  if (window.top !== window) return;
  const adapter = adapterFor(new URL(location.href));
  if (adapter === undefined || adapter.site !== site) return;

  const ferry = startFerry({
    site,
    adapter,
    doc: document,
    send: (message) => browser.runtime.sendMessage(message),
    cssText: `${tokens}\n${contentCss}`,
    fontUrl: browser.runtime.getURL('/fonts/geist-latin-wght-normal.woff2'),
  });

  // Only our own worker may drive the content script; pages cannot reach runtime.onMessage.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab !== undefined) return;
    const parsed = message as Partial<WorkerToContent> | null;
    if (parsed?.type === 'ferry.insert-suggested') void ferry.insertSuggested();
  });
}
