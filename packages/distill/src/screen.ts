import { ALWAYS_BLOCKED, MAX_FACT_CHARS, SENSITIVE_CATEGORIES, type InjectionFlag, type SensitiveCategory } from '@ferry/core';
import { flagsFor, scanInjection, type InjectionReason } from './injection.js';
import { detectSensitive } from './sensitive.js';

const SENSITIVE_REASON = {
  card_number: 'SENSITIVE_CARD',
  government_id: 'SENSITIVE_GOV_ID',
  password: 'SENSITIVE_PASSWORD',
  secret_key: 'SENSITIVE_SECRET',
  health: 'SENSITIVE_HEALTH',
  finance: 'SENSITIVE_FINANCE',
  precise_location: 'SENSITIVE_LOCATION',
  sexuality: 'SENSITIVE_SEXUALITY',
  religion: 'SENSITIVE_RELIGION',
  politics: 'SENSITIVE_POLITICS',
} as const satisfies Record<SensitiveCategory, string>;
export type SensitiveReason = (typeof SENSITIVE_REASON)[SensitiveCategory];

export type SizeReason = 'TOO_LONG' | 'EMPTY';
export type ReasonCode = InjectionReason | SensitiveReason | SizeReason;

/** Precedence when several reasons fire: blocked > quarantine > review_sensitive > accept. */
export type Verdict = 'accept' | 'review_sensitive' | 'quarantine' | 'blocked';

export interface Screening {
  /** Normalized text. Not truncated: over-long text is blocked instead of silently cut. */
  text: string;
  verdict: Verdict;
  reasons: ReasonCode[];
  flags: InjectionFlag[];
  sensitive: SensitiveCategory[];
}

export interface ScreenOptions {
  /** Categories asserted by another detector (the distill LLM); unioned with ours, never subtracted. */
  extraSensitive?: readonly SensitiveCategory[];
  /** The LLM classifier's opinion. It can only add suspicion. */
  llmInjectionSuspect?: boolean;
  maxChars?: number;
}

/**
 * The single gate every candidate fact passes before it can reach review or storage.
 * Output fields line up with core CandidateFact (`text`, `sensitive`, `flags`).
 */
export function screenCandidate(raw: string, options: ScreenOptions = {}): Screening {
  const maxChars = options.maxChars ?? MAX_FACT_CHARS;
  const injection = scanInjection(raw);
  const injectionReasons: InjectionReason[] = [...injection.reasons];
  if (options.llmInjectionSuspect === true) injectionReasons.push('LLM_CLASSIFIER');

  const detected = detectSensitive(raw).categories;
  const extra = options.extraSensitive ?? [];
  const sensitive = SENSITIVE_CATEGORIES.filter((c) => detected.includes(c) || extra.includes(c));

  const text = injection.normalized;
  const size: SizeReason[] = [];
  if (text.length === 0) size.push('EMPTY');
  if (Array.from(text).length > maxChars) size.push('TOO_LONG');

  const reasons: ReasonCode[] = [...size, ...injectionReasons, ...sensitive.map((c) => SENSITIVE_REASON[c])];
  let verdict: Verdict = 'accept';
  if (size.length > 0 || sensitive.some((c) => ALWAYS_BLOCKED.includes(c))) verdict = 'blocked';
  else if (injectionReasons.length > 0) verdict = 'quarantine';
  else if (sensitive.length > 0) verdict = 'review_sensitive';

  return { text, verdict, reasons, flags: flagsFor(injectionReasons), sensitive };
}
