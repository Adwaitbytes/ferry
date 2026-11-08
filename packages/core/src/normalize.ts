import { MAX_FACT_CHARS } from './schemas.js';

/**
 * Invisible code points used for prompt smuggling: zero-width and joiners, word joiner
 * and invisible operators, BOM, bidi embeddings/overrides/isolates, Arabic letter mark,
 * variation selectors, and the Unicode tag block (which can encode a hidden ASCII payload).
 */
const HIDDEN_CLASS =
  '[\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\u202A-\\u202E\\u2066-\\u2069\\u061C\\u180E\\uFE00-\\uFE0F\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]';
/** C0/C1 controls except tab and newline. */
const CONTROL_CLASS = '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]';
/** The header delimiters. Facts must never contain them, so no fact can forge a header. */
const BRACKET_CLASS = '[\\u27E6\\u27E7]';

// Variation selectors in the class are intentional: we strip them, we do not match them as combiners.
/* eslint-disable no-misleading-character-class */
const hasHidden = new RegExp(`${HIDDEN_CLASS}|${CONTROL_CLASS}`, 'u');
const hasBrackets = new RegExp(BRACKET_CLASS, 'u');
const stripHidden = new RegExp(HIDDEN_CLASS, 'gu');
const stripControls = new RegExp(CONTROL_CLASS, 'gu');
const stripBrackets = new RegExp(BRACKET_CLASS, 'gu');
/* eslint-enable no-misleading-character-class */

export interface NormalizeResult {
  text: string;
  hadHiddenUnicode: boolean;
  hadHeaderBrackets: boolean;
  truncated: boolean;
}

/** NFKC, strip invisible and control characters, collapse whitespace, cap length. */
export function normalizeFactText(input: string, maxChars: number = MAX_FACT_CHARS): NormalizeResult {
  const nfkc = input.normalize('NFKC');
  const cleaned = nfkc
    .replace(stripHidden, '')
    .replace(stripControls, ' ')
    .replace(stripBrackets, '')
    .replace(/\s+/g, ' ')
    .trim();

  const chars = Array.from(cleaned);
  const truncated = chars.length > maxChars;
  return {
    text: truncated ? chars.slice(0, maxChars).join('').trimEnd() : cleaned,
    hadHiddenUnicode: hasHidden.test(nfkc),
    hadHeaderBrackets: hasBrackets.test(nfkc),
    truncated,
  };
}
