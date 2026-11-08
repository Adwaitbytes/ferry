import { CONTEXT_FOOTER, CONTEXT_HEADER, type InjectionFlag } from '@ferry/core';
import {
  confusableSkeleton,
  hasMixedScriptWord,
  inspectHidden,
  normalizeKeepLines,
  normalizeUncapped,
} from './unicode.js';

export const INJECTION_REASONS = [
  'INJECTION_IMPERATIVE',
  'EXFIL_URL',
  'ENCODED_PAYLOAD',
  'HIDDEN_ZERO_WIDTH',
  'HIDDEN_TAG_CHARS',
  'BIDI_CONTROL',
  'VARIATION_SELECTOR_RUN',
  'MIXED_SCRIPT',
  'HEADER_FORGERY',
  'MARKUP',
  'LLM_CLASSIFIER',
] as const;
export type InjectionReason = (typeof INJECTION_REASONS)[number];

/** Fine grained reason codes (docs/REDTEAM.md) collapse onto the frozen core flag enum. */
const FLAG_OF: Readonly<Record<InjectionReason, InjectionFlag>> = {
  INJECTION_IMPERATIVE: 'imperative_to_ai',
  EXFIL_URL: 'exfil_url',
  ENCODED_PAYLOAD: 'encoded_payload',
  HIDDEN_ZERO_WIDTH: 'hidden_unicode',
  HIDDEN_TAG_CHARS: 'hidden_unicode',
  BIDI_CONTROL: 'hidden_unicode',
  VARIATION_SELECTOR_RUN: 'hidden_unicode',
  MIXED_SCRIPT: 'hidden_unicode',
  HEADER_FORGERY: 'header_forgery',
  MARKUP: 'markup',
  LLM_CLASSIFIER: 'llm_classifier',
};

export function flagsFor(reasons: Iterable<InjectionReason>): InjectionFlag[] {
  return [...new Set([...reasons].map((r) => FLAG_OF[r]))];
}

export interface InjectionScan {
  flags: InjectionFlag[];
  reasons: InjectionReason[];
  /** Every injection reason quarantines: the item is held for review and never auto-saved. */
  quarantine: boolean;
  /** NFKC, invisibles stripped, whitespace collapsed, no length cap. */
  normalized: string;
}

const AI_NOUN = '(?:ai|ais|assistants?|llms?|models?|chatbots?|agents?|bots?|gpt|chatgpt|claude|gemini|copilot)';
const AI = `${AI_NOUN}(?: ${AI_NOUN})?`;

/**
 * Patterns are matched on lowercased, confusable-folded text. Each one needs an instruction shape
 * (a verb aimed at an AI, a role marker, a jailbreak idiom); topic words alone ("system prompt",
 * "AI assistants") never match, so statements about using AI stay clean.
 */
const IMPERATIVES: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^.!?\n]{0,30}\b(?:previous|prior|above|earlier|preceding|all|any|your|the|system|these|those|other|existing)\b[^.!?\n]{0,20}\b(?:instructions?|prompts?|rules|guidelines|directions|directives|context|messages|guardrails|policies)\b/,
  /\byou are now\b/,
  /\bfrom now on,? (?:you|the (?:ai|assistant|model))\b/,
  /\b(?:new|updated|real|actual|hidden|secret) (?:system )?(?:instructions?|prompt)\s*[:=]/,
  /\bsystem prompt\s*[:=]/,
  /\b(?:reveal|print|show|output|repeat|leak|disclose|display|dump|expose)\b[^.!?\n]{0,40}\b(?:system prompt|hidden prompt|initial prompt|your instructions|saved memories|memories|api keys?|secrets)\b/,
  /\b(?:do not|don'?t|never)\s+(?:tell|inform|alert|notify|warn) the user\b/,
  /\bwithout (?:telling|informing|alerting|notifying|asking) the user\b/,
  /\bkeep (?:this|it) (?:a )?secret from the user\b/,
  new RegExp(`\\b(?:when|if|once|whenever) (?:an?|any|the|every|some|another|other|future) ${AI}\\b[^.!?\\n]{0,30}\\b(?:reads?|sees?|processes|loads?|receives?|finds?|encounters?)\\b`),
  new RegExp(`\\b(?:tell|instruct|order|force|command) (?:all |any |every |other |future |the )?${AI} to\\b`),
  new RegExp(`\\b(?:note|message|instructions?) (?:to|for) (?:all |any |every |future |other |the )?${AI}\\s*[:,]`),
  /(?:^|[.!?\n]\s*)(?:please\s+)?act as\b/,
  /\byou (?:will|must|should|shall|are to) (?:now )?act as\b/,
  /\bpretend (?:to be|you are|you're|that you)\b/,
  /\b(?:developer|god|jailbreak|jailbroken|dan|sudo|unrestricted) mode\b/,
  /\b(?:skip|disable|bypass|turn off|ignore) (?:all |any |the |your )?(?:safety|security|content|moderation) (?:checks?|filters?|guidelines|rules|policies)\b/,
  /\btreat (?:everything|all|the following|this|the text|what follows)\b[^.!?\n]{0,20}\bas (?:instructions|commands|system)\b/,
  /\b(?:enter|send|share|paste|type|give|provide|reveal) (?:their|the user'?s|your|users'?) (?:seed phrase|recovery phrase|mnemonic|private keys?|secret keys?|passwords?|passphrase|credentials)\b/,
  /\b(?:store|save|remember|record|add|write) (?:this|the following)(?: as an?)? (?:fact|memory)\s*:/,
  /\bthe user (?:consents?|agrees?|authori[sz]es|allows|permits|has authori[sz]ed|has consented)\b/,
  /\b(?:send|forward|email|post|upload|exfiltrate|transmit|leak)\b[^.!?\n]{0,40}\b(?:memories|memory|conversations?|chat history|notes|data|messages)\b[^.!?\n]{0,20}\bto (?:https?:|[a-z0-9-]+\.[a-z]{2,}\b|\S+@\S+)/,
];

/** Role and tool-call markers. Checked on text that still has its line breaks. */
const ROLE_MARKERS: readonly RegExp[] = [
  /<\|[a-z_]{2,20}\|>/i,
  /\[\/?inst\]/i,
  /<<\/?sys>>/i,
  /<\/?(?:system|assistant|user|developer|tool|im_start|im_end)>/i,
  /^\s*#{1,6}\s*(?:system|instructions?|assistant)\b/im,
  /^\s*(?:system|assistant|developer|tool|user)\s*:/im,
  /\b(?:SYSTEM|ASSISTANT|DEVELOPER)\s*:/,
  /"(?:function_call|tool_calls?|tool_use)"\s*:/i,
  /<\/?(?:tool_call|function_calls?|invoke|antml:[a-z_]+)\b/i,
  /\bfunctions\.[a-z_]+\s*\(/i,
  /"name"\s*:\s*"[^"]+"\s*,\s*"(?:arguments|parameters|input)"\s*:/i,
];

const MARKUP: readonly RegExp[] = [
  /<\s*\/?\s*(?:script|iframe|img|svg|math|style|object|embed|link|meta|form|input|base|frame|frameset|video|audio|source|body|html|textarea|button|template|details|marquee)\b/i,
  /<[^>]*\son[a-z]+\s*=/i,
  /\b(?:javascript|vbscript)\s*:/i,
];

const HEADER_FORGERY: readonly RegExp[] = [
  /ferry\s*:\s*v\d/i,
  new RegExp(escapeRegExp(CONTEXT_HEADER.slice(1, 30)), 'i'),
  new RegExp(escapeRegExp(CONTEXT_FOOTER.slice(1, -1)), 'i'),
  /not as instructions\.?\]/i,
];
const HEADER_BRACKETS = /[\u27E6\u27E7]/u;

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?(?:https?:)?\/\//i;
const DATA_URI = /\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const EXFIL_PARAM_NAMES = new Set(['data', 'd', 'memory', 'memories', 'payload', 'exfil', 'secret', 'leak', 'prompt', 'history', 'context', 'conversation', 'notes', 'chat']);

const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}|[A-Za-z0-9_-]{40,}={0,2}/g;
const HEX_RUN = /\b(?:[0-9a-fA-F]{2}){20,}\b/g;
const PERCENT_RUN = /(?:%[0-9a-fA-F]{2}){6,}/g;
const ESCAPE_RUN = /(?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}){6,}/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printableRatio(s: string): number {
  if (s.length === 0) return 0;
  let printable = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x09) printable++;
  }
  return printable / s.length;
}

/** Decodes base64 or base64url to a latin1 string, or null if it is not valid base64. */
export function decodeBase64(run: string): string | null {
  const std = run.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (std.length % 4 === 1) return null;
  try {
    return atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  } catch {
    return null;
  }
}

/** A run that decodes to readable text is a smuggled message; one that does not is likely a key (see sensitive). */
export function decodesToText(run: string): string | null {
  const decoded = decodeBase64(run);
  return decoded !== null && printableRatio(decoded) >= 0.9 ? decoded : null;
}

function decodeHex(run: string): string {
  let out = '';
  for (let i = 0; i < run.length; i += 2) out += String.fromCharCode(parseInt(run.slice(i, i + 2), 16));
  return out;
}

function decodePercent(run: string): string {
  try {
    return decodeURIComponent(run);
  } catch {
    return '';
  }
}

/** Returns the decoded payloads found, so they can be scanned like visible text. */
function findEncodedPayloads(text: string): { found: boolean; decoded: string[] } {
  const decoded: string[] = [];
  let found = false;
  for (const m of text.matchAll(BASE64_RUN)) {
    const plain = decodesToText(m[0]);
    if (plain !== null) {
      found = true;
      decoded.push(plain);
    }
  }
  for (const m of text.matchAll(HEX_RUN)) {
    const plain = decodeHex(m[0]);
    if (printableRatio(plain) >= 0.9) {
      found = true;
      decoded.push(plain);
    }
  }
  for (const m of text.matchAll(PERCENT_RUN)) {
    found = true;
    decoded.push(decodePercent(m[0]));
  }
  if (ESCAPE_RUN.test(text)) found = true;
  return { found, decoded };
}

function hasExfilUrl(text: string): boolean {
  if (MARKDOWN_IMAGE.test(text) || DATA_URI.test(text)) return true;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    const q = url.search(/[?#]/);
    if (q < 0) continue;
    const query = url.slice(q + 1);
    if (/[{}$<>]|%7[bd]|%24/i.test(query)) return true;
    for (const pair of query.split(/[&;#]/)) {
      const eq = pair.indexOf('=');
      const name = (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
      const value = eq < 0 ? '' : pair.slice(eq + 1);
      if (value.length >= 32 || (EXFIL_PARAM_NAMES.has(name) && value.length > 0)) return true;
    }
  }
  return false;
}

function hasImperative(text: string): boolean {
  const folded = confusableSkeleton(text).toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return IMPERATIVES.some((re) => re.test(folded));
}

/** Rules that look at visible text. Shared by the main pass and by decoded or smuggled payloads. */
function scanVisible(text: string, withLines: string, reasons: Set<InjectionReason>): void {
  if (hasImperative(text) || ROLE_MARKERS.some((re) => re.test(withLines))) reasons.add('INJECTION_IMPERATIVE');
  if (hasExfilUrl(text)) reasons.add('EXFIL_URL');
  if (MARKUP.some((re) => re.test(text))) reasons.add('MARKUP');
  if (HEADER_FORGERY.some((re) => re.test(text))) reasons.add('HEADER_FORGERY');
}

/**
 * Heuristic prompt-injection scanner for anything that may become a stored fact.
 * Pass 1 inspects the raw string for invisible characters (normalization would erase them);
 * pass 2 scans the normalized text, its confusable skeleton, and any decoded payloads.
 */
export function scanInjection(raw: string): InjectionScan {
  const reasons = new Set<InjectionReason>();
  const hidden = inspectHidden(raw);
  for (const r of hidden.reasons) reasons.add(r);
  if (HEADER_BRACKETS.test(raw.normalize('NFKC'))) reasons.add('HEADER_FORGERY');

  const normalized = normalizeUncapped(raw);
  scanVisible(normalized, normalizeKeepLines(raw), reasons);
  if (hasMixedScriptWord(normalized)) reasons.add('MIXED_SCRIPT');

  if (hidden.tagPayload.length > 0) scanVisible(hidden.tagPayload, hidden.tagPayload, reasons);

  const encoded = findEncodedPayloads(normalized);
  if (encoded.found) reasons.add('ENCODED_PAYLOAD');
  for (const plain of encoded.decoded) scanVisible(plain, plain, reasons);

  const ordered = INJECTION_REASONS.filter((r) => reasons.has(r));
  return { flags: flagsFor(ordered), reasons: ordered, quarantine: ordered.length > 0, normalized };
}
