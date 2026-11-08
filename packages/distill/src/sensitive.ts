import { validateMnemonic } from '@scure/bip39';
import { wordlist as BIP39_ENGLISH } from '@scure/bip39/wordlists/english.js';
import { ALWAYS_BLOCKED, SENSITIVE_CATEGORIES, type SensitiveCategory } from '@ferry/core';
import { decodesToText } from './injection.js';
import { foldDigits, normalizeUncapped } from './unicode.js';

export interface SensitiveScan {
  categories: SensitiveCategory[];
  /** True when any category is in core ALWAYS_BLOCKED: never written, whatever the user chooses. */
  blocked: boolean;
}

/* ------------------------------------------------------------------ */
/* Checksums                                                           */
/* ------------------------------------------------------------------ */

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Aadhaar's check digit scheme. */
export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const rev = [...digits].reverse();
  rev.forEach((ch, i) => {
    c = VERHOEFF_D[c]?.[VERHOEFF_P[i % 8]?.[Number(ch)] ?? 0] ?? 0;
  });
  return c === 0;
}

/** ISO 13616 mod 97 check. */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

// Lookarounds stop a match from starting or ending inside a longer separated digit run.
const CARD_RUN = /(?<!\d[ .-]?)\d(?:[ .-]?\d){12,18}(?![ .-]?\d)/g;
const AADHAAR_RUN = /(?<!\d[ .-]?)[2-9]\d{3}[ .-]?\d{4}[ .-]?\d{4}(?![ .-]?\d)/g;
const IBAN_RUN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;

const GOV_ID: readonly RegExp[] = [
  /(?<!\d[ -]?)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![ -]?\d)/,
  /\b(?:ssn|social security(?: number)?)\b[^.\d]{0,20}\d{3}[ -]?\d{2}[ -]?\d{4}\b/i,
  /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/,
  /\bpassport\b[^.]{0,25}?\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,9}\b/i,
  /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/,
];

const PASSWORD = /\b(password|passcode|passwd|passphrase|pass|pwd|pw|pin)\b(?:\s+(?:for|to|of|on)\s+[^.,;:!?]{1,40}?)?\s*(?:is|was|=|:)\s*([^\s,;]{3,})/gi;
const PASSWORD_NON_VALUES = new Set([
  'a', 'the', 'too', 'very', 'weak', 'strong', 'long', 'short', 'secure', 'safe', 'same', 'different', 'stored',
  'saved', 'managed', 'not', 'never', 'always', 'expired', 'reset', 'changed', 'required', 'needed', 'missing',
  'wrong', 'correct', 'incorrect', 'forgotten', 'lost', 'unique', 'random', 'complex', 'simple', 'easy', 'hard',
  'valid', 'invalid', 'ready', 'here', 'there', 'printed', 'shared', 'private', 'personal', 'something', 'written',
]);
/** "pass" and "pin" are everyday words (bus pass, pin a tab); their values must look like a secret. */
const WEAK_KEYWORDS = new Set(['pass', 'pin']);

const SECRET: readonly RegExp[] = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsuiprivkey1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}/i,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bhf_[A-Za-z0-9]{30,}\b/,
];
const TOKEN_CANDIDATE = /[A-Za-z0-9+/_=-]{32,}/g;
const BIP39_SET = new Set(BIP39_ENGLISH);
const MNEMONIC_LENGTHS = [24, 21, 18, 15, 12];
const MNEMONIC_CONTEXT = /\b(?:seed|mnemonic|recovery|secret phrase|wallet|backup phrase)\b/;

const AMOUNT = String.raw`(?:[$€£₹¥]\s?\d|\d[\d,.]*\s?(?:k|m|mn|lpa|lakhs?|crores?|usd|eur|gbp|inr|dollars|euros|pounds|rupees)\b|\d{4,})`;
const FINANCE: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:salary|income|earn(?:s|ing)?|take-home|paycheck|net worth|savings|debt|loans?|mortgage|bank balance|ctc|bonus|invested|portfolio|owe)\b[^.!?\n]{0,30}?${AMOUNT}`, 'i'),
  /(?:[$€£₹¥]\s?\d[\d,.]*\s?k?|\d[\d,.]*\s?(?:k|lpa|usd|eur|gbp|inr|dollars|euros|pounds|rupees)\b)[^.!?\n]{0,20}\b(?:salary|a year|per year|per annum|annually|a month|per month)\b/i,
  /\b(?:bank )?(?:account|acct|a\/c|routing|sort code)\s*(?:number|no\.?|num|#)?\s*(?:is|:)?\s*\d[\d -]{4,}\d/i,
  /\bcredit score\s*(?:is|of|:)?\s*\d{3}\b/i,
  /\b[A-Z]{4}0[A-Z0-9]{6}\b/,
];

const HEALTH: readonly RegExp[] = [
  /\b(?:diagnosed|diagnosis|prescribed|prescription|medications?|meds|chemo(?:therapy)?|insulin|antidepressants?|therapist|psychiatrist|disorder|diabetes|diabetic|cancer|tumou?r|hiv|hepatitis|depression|depressed|anxiety|adhd|autism|autistic|bipolar|schizophrenia|ptsd|ocd|asthma|epilepsy|seizures?|pregnant|pregnancy|miscarriage|ivf|hypertension|blood pressure|cholesterol|migraines?|thyroid|arthritis|dementia|alzheimer'?s|parkinson'?s|surgery|rehab|addiction|relapse)\b/i,
  /\b\d+(?:\.\d+)?\s?(?:mg|mcg)\b/i,
];

const STREET_SUFFIXES = ['street', 'st', 'avenue', 'ave', 'road', 'rd', 'lane', 'ln', 'boulevard', 'blvd', 'drive', 'dr', 'court', 'ct', 'way', 'place', 'pl', 'terrace', 'crescent', 'close', 'highway', 'hwy', 'marg', 'nagar', 'layout'];
const SUFFIX_ALT = STREET_SUFFIXES.map((s) => `[${s[0]?.toUpperCase() ?? ''}${s[0] ?? ''}]${s.slice(1)}`).join('|');
const LOCATION: readonly RegExp[] = [
  new RegExp(String.raw`\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][\w'.-]*\s+){1,4}(?:${SUFFIX_ALT})\b`),
  /-?\b\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/,
  /\b(?:live|living|stay|staying|reside|home is) at\b[^.]{0,10}\d/i,
  /\b(?:flat|apt|apartment|unit|suite)\s*(?:no\.?\s*|#\s*)?\d+[A-Z]?\b/i,
];

const FIRST_PERSON = String.raw`\b(?:i am|i'm|im|as an?)\s+(?:an?\s+)?`;
const SEXUALITY = new RegExp(`${FIRST_PERSON}(?:gay|lesbian|bisexual|bi|queer|asexual|pansexual|trans|transgender|nonbinary|non-binary|homosexual)\\b`, 'i');
const RELIGION: readonly RegExp[] = [
  new RegExp(`${FIRST_PERSON}(?:muslim|christian|catholic|protestant|hindu|jewish|jew|buddhist|sikh|jain|atheist|agnostic|mormon)\\b`, 'i'),
  /\bi (?:pray|fast) (?:during|for|on|five|every)\b/i,
  /\b(?:ramadan|my church|my mosque|my temple|my synagogue|my gurdwara)\b/i,
];
const POLITICS: readonly RegExp[] = [
  /\b(?:i|we) (?:vote|voted|support|supported|am a member of|campaign for|campaigned for)\b[^.]{0,20}\b(?:democrats?|republicans?|labour|conservatives?|tories|tory|lib dems?|greens?|bjp|congress|aap|party|trump|biden|harris|modi)\b/i,
  new RegExp(`${FIRST_PERSON}(?:liberal|conservative|progressive|socialist|communist|libertarian|democrat|republican)\\b`, 'i'),
];

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

function hasCard(text: string): boolean {
  for (const m of text.matchAll(CARD_RUN)) {
    const d = digitsOf(m[0]);
    if (d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhnValid(d)) return true;
  }
  return false;
}

function hasGovernmentId(text: string): boolean {
  for (const m of text.matchAll(AADHAAR_RUN)) {
    if (verhoeffValid(digitsOf(m[0]))) return true;
  }
  return GOV_ID.some((re) => re.test(text));
}

function hasPassword(text: string): boolean {
  for (const m of text.matchAll(PASSWORD)) {
    const keyword = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').replace(/[.!?]+$/, '');
    if (value.length < 3 || PASSWORD_NON_VALUES.has(value.toLowerCase())) continue;
    if (!WEAK_KEYWORDS.has(keyword) || /[\d\W_]/.test(value)) return true;
  }
  return false;
}

/**
 * A run of BIP39 words with a valid checksum. Sliding a window over long runs would make the
 * 4-bit checksum pass by chance, so without wallet context the whole run must be the mnemonic;
 * with context, windows anchored at either end of the run are also checked.
 */
function hasMnemonic(text: string): boolean {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  const context = MNEMONIC_CONTEXT.test(lower);
  const valid = (run: readonly string[]): boolean => validateMnemonic(run.join(' '), BIP39_ENGLISH);
  let runStart = 0;
  for (let i = 0; i <= words.length; i++) {
    if (i < words.length && BIP39_SET.has(words[i] ?? '')) continue;
    const run = words.slice(runStart, i);
    runStart = i + 1;
    if (MNEMONIC_LENGTHS.includes(run.length) && valid(run)) return true;
    if (!context) continue;
    for (const len of MNEMONIC_LENGTHS) {
      if (run.length > len && (valid(run.slice(0, len)) || valid(run.slice(-len)))) return true;
    }
  }
  return false;
}

function hasHighEntropyToken(text: string): boolean {
  for (const m of text.matchAll(TOKEN_CANDIDATE)) {
    const t = m[0];
    const mixed = /[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t);
    if (mixed && shannonEntropy(t) >= 4 && decodesToText(t) === null) return true;
  }
  return false;
}

function hasSecret(text: string): boolean {
  return SECRET.some((re) => re.test(text)) || hasHighEntropyToken(text) || hasMnemonic(text);
}

function hasFinance(text: string): boolean {
  for (const m of text.matchAll(IBAN_RUN)) if (ibanValid(m[0])) return true;
  return FINANCE.some((re) => re.test(text));
}

/**
 * Sensitive data detector. Runs on NFKC text with invisibles stripped and native digits folded,
 * so digits split by zero-width characters or written fullwidth are still seen (X-INJ-3).
 */
export function detectSensitive(raw: string): SensitiveScan {
  const text = foldDigits(normalizeUncapped(raw));
  // IBANs contain long digit runs that can pass Luhn; mask them before card and id checks.
  const withoutIban = text.replace(IBAN_RUN, (m) => (ibanValid(m) ? ' ' : m));
  const found = new Set<SensitiveCategory>();
  if (hasCard(withoutIban)) found.add('card_number');
  if (hasGovernmentId(withoutIban)) found.add('government_id');
  if (hasPassword(text)) found.add('password');
  if (hasSecret(text)) found.add('secret_key');
  if (hasFinance(text)) found.add('finance');
  if (HEALTH.some((re) => re.test(text))) found.add('health');
  if (LOCATION.some((re) => re.test(text))) found.add('precise_location');
  if (SEXUALITY.test(text)) found.add('sexuality');
  if (RELIGION.some((re) => re.test(text))) found.add('religion');
  if (POLITICS.some((re) => re.test(text))) found.add('politics');

  const categories = SENSITIVE_CATEGORIES.filter((c) => found.has(c));
  return { categories, blocked: categories.some((c) => ALWAYS_BLOCKED.includes(c)) };
}
