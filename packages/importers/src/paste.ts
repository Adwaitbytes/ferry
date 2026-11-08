import { cleanText, dedupeKey } from './text.js';

/** Threat model X-IMP: paste box cap. */
export const MAX_PASTE_CHARS = 200_000;

/** Lines longer than this are split into sentences so each candidate stays one claim. */
const LONG_LINE = 300;

const BULLET = /^(?:[-*+\u2022\u25E6\u2023>]+|\d{1,3}[.)])\s+/;
const HEADING = /^#{1,6}\s+/;

/**
 * Splits an assistant's "what do you know about me" answer into candidate lines. Markdown bullets,
 * headings and emphasis are stripped; bare section labels ("Preferences:") are dropped.
 */
export function splitPasteCandidates(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of cleanText(input).split('\n')) {
    const line = rawLine.trim().replace(HEADING, '').replace(BULLET, '').replace(/\*\*|__/g, '').trim();
    if (line.length < 3) continue;
    if (line.endsWith(':') && line.length <= 60) continue;
    const sentences = line.length > LONG_LINE ? line.split(/(?<=[.!?])\s+/) : [line];
    for (const sentence of sentences) {
      const text = sentence.trim();
      const key = dedupeKey(text);
      if (text.length < 3 || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}
