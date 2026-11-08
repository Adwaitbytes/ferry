import { normalizeFactText } from '@ferry/core';

export type HiddenReason = 'HIDDEN_ZERO_WIDTH' | 'HIDDEN_TAG_CHARS' | 'BIDI_CONTROL' | 'VARIATION_SELECTOR_RUN';

export interface HiddenInspection {
  reasons: Set<HiddenReason>;
  /** ASCII text smuggled in Unicode tag characters, decoded so it can be scanned like visible text. */
  tagPayload: string;
}

const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const ASCII_ALNUM = /^[A-Za-z0-9]$/;
const BLACK_FLAG = 0x1f3f4;
const TAG_CANCEL = 0xe007f;

function isTag(cp: number): boolean {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

function isBidiEmbedding(cp: number): boolean {
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

function isBidiMark(cp: number): boolean {
  return cp === 0x200e || cp === 0x200f || cp === 0x061c;
}

function isZeroWidth(cp: number): boolean {
  return cp === 0x200b || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x180e;
}

function isControl(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false;
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * Subdivision flags (England, Scotland, Wales) are the one legitimate use of tag characters:
 * U+1F3F4, then lowercase letters or digits as tags, then CANCEL TAG.
 */
function isEmojiFlagTagRun(cps: readonly number[], start: number, end: number): boolean {
  if (start === 0 || cps[start - 1] !== BLACK_FLAG || cps[end - 1] !== TAG_CANCEL) return false;
  for (let i = start; i < end - 1; i++) {
    const c = (cps[i] ?? 0) - 0xe0000;
    const lowerOrDigit = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
    if (!lowerOrDigit) return false;
  }
  return end - start <= 8;
}

function charAt(cps: readonly number[], i: number): string {
  const cp = cps[i];
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * Runs on the raw text, before NFKC and stripping, because normalization deletes exactly the
 * evidence we need (X-INJ-2). Joiners are tolerated where scripts and emoji need them.
 */
export function inspectHidden(raw: string): HiddenInspection {
  const cps = Array.from(raw, (c) => c.codePointAt(0) ?? 0);
  const reasons = new Set<HiddenReason>();
  const hasRtl = RTL_LETTER.test(raw);
  let tagPayload = '';

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i] ?? 0;
    if (isTag(cp)) {
      let end = i;
      while (end < cps.length && isTag(cps[end] ?? 0)) end++;
      if (!isEmojiFlagTagRun(cps, i, end)) {
        reasons.add('HIDDEN_TAG_CHARS');
        for (let j = i; j < end; j++) {
          const ascii = (cps[j] ?? 0) - 0xe0000;
          if (ascii >= 0x20 && ascii <= 0x7e) tagPayload += String.fromCharCode(ascii);
        }
        tagPayload += ' ';
      }
      i = end - 1;
    } else if (isVariationSelector(cp)) {
      let end = i;
      while (end < cps.length && isVariationSelector(cps[end] ?? 0)) end++;
      if (end - i > 1) reasons.add('VARIATION_SELECTOR_RUN');
      i = end - 1;
    } else if (isBidiEmbedding(cp) || (isBidiMark(cp) && !hasRtl)) {
      reasons.add('BIDI_CONTROL');
    } else if (isZeroWidth(cp) && !(cp === 0xfeff && i === 0)) {
      reasons.add('HIDDEN_ZERO_WIDTH');
    } else if (cp === 0x200c || cp === 0x200d) {
      // Joiners are required inside emoji sequences and Indic or Persian words; between ASCII
      // letters they only serve to split a keyword so a filter misses it.
      if (ASCII_ALNUM.test(charAt(cps, i - 1)) || ASCII_ALNUM.test(charAt(cps, i + 1))) {
        reasons.add('HIDDEN_ZERO_WIDTH');
      }
    } else if (isControl(cp)) {
      reasons.add('HIDDEN_ZERO_WIDTH');
    }
  }
  return { reasons, tagPayload: tagPayload.trim() };
}

/** Normalized text with no length cap, so callers can measure length instead of truncating silently. */
export function normalizeUncapped(raw: string): string {
  return normalizeFactText(raw, Number.MAX_SAFE_INTEGER).text;
}

// Mirrors the set core strips; core keeps its pattern private.
// eslint-disable-next-line no-misleading-character-class
const STRIP_INVISIBLE = /[\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069\u061C\u180E\uFE00-\uFE0F\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** NFKC with invisibles removed but line breaks kept, for rules that depend on line starts. */
export function normalizeKeepLines(raw: string): string {
  return raw.normalize('NFKC').replace(STRIP_INVISIBLE, '').replace(/\r\n?/g, '\n');
}

/**
 * Confusable skeleton for the Cyrillic and Greek letters that render identically to Latin.
 * Matching imperatives on the skeleton defeats "Ignore" spelled with Cyrillic U+043E.
 */
const CONFUSABLES: ReadonlyMap<number, string> = new Map([
  [0x0430, 'a'], [0x0432, 'b'], [0x0435, 'e'], [0x0451, 'e'], [0x043a, 'k'], [0x043c, 'm'], [0x043d, 'h'], [0x043e, 'o'],
  [0x0440, 'p'], [0x0441, 'c'], [0x0442, 't'], [0x0443, 'y'], [0x0445, 'x'], [0x0456, 'i'], [0x0457, 'i'], [0x0458, 'j'],
  [0x0455, 's'], [0x04bb, 'h'], [0x0501, 'd'], [0x051b, 'q'], [0x051d, 'w'], [0x04cf, 'l'], [0x0261, 'g'], [0x0410, 'A'],
  [0x0412, 'B'], [0x0415, 'E'], [0x041a, 'K'], [0x041c, 'M'], [0x041d, 'H'], [0x041e, 'O'], [0x0420, 'P'], [0x0421, 'C'],
  [0x0422, 'T'], [0x0423, 'Y'], [0x0425, 'X'], [0x0406, 'I'], [0x0408, 'J'], [0x0405, 'S'], [0x03b1, 'a'], [0x03bf, 'o'],
  [0x03b9, 'i'], [0x03ba, 'k'], [0x03bd, 'v'], [0x03c1, 'p'], [0x03c4, 't'], [0x03c5, 'u'], [0x03c7, 'x'], [0x03b5, 'e'],
  [0x0391, 'A'], [0x0392, 'B'], [0x0395, 'E'], [0x0396, 'Z'], [0x0397, 'H'], [0x0399, 'I'], [0x039a, 'K'], [0x039c, 'M'],
  [0x039d, 'N'], [0x039f, 'O'], [0x03a1, 'P'], [0x03a4, 'T'], [0x03a5, 'Y'], [0x03a7, 'X'],
]);

export function confusableSkeleton(text: string): string {
  let out = '';
  for (const ch of text) out += CONFUSABLES.get(ch.codePointAt(0) ?? 0) ?? ch;
  return out;
}

const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/** True when a single word mixes Latin with Cyrillic or Greek letters, the shape of a homoglyph attack. */
export function hasMixedScriptWord(text: string): boolean {
  for (const word of text.match(/\p{L}+/gu) ?? []) {
    if (LATIN.test(word) && LOOKALIKE_SCRIPT.test(word)) return true;
  }
  return false;
}

const DIGIT_ZEROS = [0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810];

/** NFKC folds fullwidth and math digits; this folds the native digit blocks NFKC leaves alone. */
export function foldDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}
