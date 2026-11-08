import { chatgptAdapter } from './sites/chatgpt.js';
import { claudeAdapter } from './sites/claude.js';
import { geminiAdapter } from './sites/gemini.js';
import type { SiteAdapter } from './types.js';

export const adapters: readonly SiteAdapter[] = [chatgptAdapter, claudeAdapter, geminiAdapter];

/** The adapter for an exact supported https host, or undefined. Lookalike hosts never match. */
export function adapterFor(url: URL | string): SiteAdapter | undefined {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return undefined;
  }
  return adapters.find((adapter) => adapter.matches(parsed));
}
