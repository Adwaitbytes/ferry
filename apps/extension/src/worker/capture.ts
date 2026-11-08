import {
  hashShort,
  normalizeFactText,
  type CandidateFact,
  type DistilledFact,
  type InjectionFlag,
  type Site,
} from '@ferry/core';
import { isLikelyDurableFact, screenCandidate } from '@ferry/distill';
import { SITE_BY_ORIGIN } from '../lib/config';
import type { FerryApi } from './ports';
import type { SiteSettings } from './settings';
import { originOf } from './senders';

export interface CaptureProposal {
  fact: CandidateFact;
  /** True when the fact touches a sensitive category: it is always shown, never saved silently. */
  sensitive: boolean;
  /** True only when the site is in auto mode and the fact is non-sensitive and unflagged. */
  autoSave: boolean;
}

export interface CaptureInput {
  site: Site;
  userText: string;
  conversationUrl?: string | undefined;
}

function comparable(text: string, max: number): string {
  return normalizeFactText(text, max).text.toLowerCase();
}

/** The receipt quote must be the user's own words, or the fact has no provenance (X-DIS-2). */
function quoteIsFromUser(quote: string, userText: string): boolean {
  const q = comparable(quote, 200);
  return q.length >= 3 && comparable(userText, 8000).includes(q);
}

function pickBest(facts: readonly DistilledFact[], userText: string): DistilledFact | null {
  const usable = facts.filter(
    (f) => f.text.trim().length > 0 && quoteIsFromUser(f.quote, userText),
  );
  usable.sort((a, b) => b.confidence - a.confidence);
  return usable[0] ?? null;
}

/** Only a URL on the same chat site may be kept as the receipt link. */
function sameSiteUrl(site: Site, url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const origin = originOf(url);
  return origin !== null && SITE_BY_ORIGIN[origin] === site && url.startsWith('https://')
    ? url
    : undefined;
}

/**
 * Capture pipeline for one sent user message (PRD F3): cheap local heuristic first, then the Ferry
 * capture endpoint, then the local screener. Blocked and flagged candidates are dropped here, so
 * the page never even sees them offered.
 */
export async function proposeCapture(
  input: CaptureInput,
  deps: { api: FerryApi; site: SiteSettings; now: () => number; newId: () => string },
): Promise<CaptureProposal | null> {
  if (!deps.site.capture) return null;
  if (!isLikelyDurableFact(input.userText)) return null;

  const conversationUrl = sameSiteUrl(input.site, input.conversationUrl);
  const conversationIdHash = await hashShort(conversationUrl ?? `${input.site}:live`);
  const messageAt = new Date(deps.now()).toISOString();
  const distilled = await deps.api.distillMessage({
    site: input.site,
    userText: input.userText,
    conversationIdHash,
    messageAt,
  });
  const best = pickBest(distilled, input.userText);
  if (best === null) return null;

  const factScreen = screenCandidate(best.text, {
    extraSensitive: best.sensitive,
    llmInjectionSuspect: best.injectionSuspect,
  });
  const quoteScreen = screenCandidate(best.quote);
  if (factScreen.verdict === 'blocked' || quoteScreen.verdict === 'blocked') return null;
  if (factScreen.verdict === 'quarantine' || quoteScreen.verdict === 'quarantine') return null;

  const flags: InjectionFlag[] = [...new Set([...factScreen.flags, ...quoteScreen.flags])];
  const sensitive = [...new Set([...factScreen.sensitive, ...quoteScreen.sensitive])];
  const quote = normalizeFactText(best.quote, 200).text;

  const fact: CandidateFact = {
    id: deps.newId(),
    text: factScreen.text,
    type: best.type,
    receipts: [
      {
        vendor: input.site,
        conversationIdHash,
        ...(conversationUrl !== undefined ? { conversationUrl } : {}),
        messageAt,
        quote,
        quoteHash: await hashShort(quote),
        confidence: best.confidence,
      },
    ],
    sensitive,
    flags,
  };

  const isSensitive = sensitive.length > 0 || factScreen.verdict === 'review_sensitive';
  return {
    fact,
    sensitive: isSensitive,
    autoSave:
      deps.site.auto && !isSensitive && flags.length === 0 && factScreen.verdict === 'accept',
  };
}

/**
 * Re-screens text the user edited in the toast before it is saved. Returns null when the edit
 * would be blocked or flagged.
 */
export function screenEdited(original: CandidateFact, editedText: string): CandidateFact | null {
  const screen = screenCandidate(editedText);
  if (screen.verdict === 'blocked' || screen.verdict === 'quarantine') return null;
  return {
    ...original,
    text: screen.text,
    sensitive: [...new Set([...original.sensitive, ...screen.sensitive])],
    flags: [...new Set([...original.flags, ...screen.flags])],
  };
}
