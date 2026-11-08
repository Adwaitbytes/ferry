import { normalizeFactText, type Site, type Suggestion } from '@ferry/core';

/** THREAT_MODEL X-MSG-3 caps recall queries at 256 chars; the end of the draft carries the intent. */
export const MAX_QUERY_CHARS = 256;
/** X-MSG-4: at most one recall per tab per this interval. Matches the composer debounce. */
export const RECALL_INTERVAL_MS = 600;
const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 64;
const SUGGESTIONS_PER_DRAFT = 6;

export function draftQuery(draft: string): string {
  const text = normalizeFactText(draft, 4000).text;
  return Array.from(text).slice(-MAX_QUERY_CHARS).join('').trim();
}

/**
 * Recall shares the relayer's per-key point budget with writes (RESEARCH 1.2), so repeated drafts
 * are served from a short per-site cache and each tab is rate limited.
 */
export class RecallService {
  private readonly cache = new Map<string, { at: number; suggestions: Suggestion[] }>();
  private readonly lastByTab = new Map<number, number>();
  /** What each tab was shown. `inject.compose` may only reference these refs. */
  private readonly shownByTab = new Map<number, Map<string, Suggestion>>();

  constructor(private readonly now: () => number) {}

  /** Returns milliseconds to wait, or 0 when the tab may recall now. */
  retryAfter(tabId: number): number {
    const last = this.lastByTab.get(tabId);
    if (last === undefined) return 0;
    return Math.max(0, last + RECALL_INTERVAL_MS - this.now());
  }

  async suggest(
    tabId: number,
    site: Site,
    draft: string,
    recall: (query: string, k: number) => Promise<Suggestion[]>,
  ): Promise<Suggestion[]> {
    const query = draftQuery(draft);
    if (query.length < 3) return [];
    this.lastByTab.set(tabId, this.now());

    const key = `${site}\u0000${query.toLowerCase()}`;
    const hit = this.cache.get(key);
    let suggestions: Suggestion[];
    if (hit !== undefined && this.now() - hit.at < CACHE_TTL_MS) {
      suggestions = hit.suggestions;
    } else {
      suggestions = (await recall(query, SUGGESTIONS_PER_DRAFT)).slice(0, SUGGESTIONS_PER_DRAFT);
      this.cache.set(key, { at: this.now(), suggestions });
      if (this.cache.size > CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    this.shownByTab.set(tabId, new Map(suggestions.map((s) => [s.ref, s])));
    return suggestions;
  }

  /** Texts for refs this tab was actually shown, in the order requested; null if any ref is unknown. */
  shownTexts(tabId: number, refs: readonly string[]): string[] | null {
    const shown = this.shownByTab.get(tabId);
    if (shown === undefined) return null;
    const texts: string[] = [];
    for (const ref of refs) {
      const s = shown.get(ref);
      if (s === undefined) return null;
      texts.push(s.text);
    }
    return texts;
  }

  forgetTab(tabId: number): void {
    this.lastByTab.delete(tabId);
    this.shownByTab.delete(tabId);
  }

  clear(): void {
    this.cache.clear();
    this.lastByTab.clear();
    this.shownByTab.clear();
  }
}
