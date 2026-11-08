import { FerryHeader, type FactType, type Vendor } from './schemas.js';
import { normalizeFactText } from './normalize.js';

const OPEN = '⟦';
const CLOSE = '⟧';
const PREFIX = `${OPEN}ferry:v1 `;
/** The header is always the final line; anything bracket-like earlier is fact text and was stripped. */
const HEADER_LINE = /\n⟦ferry:v1 ([^⟦⟧\n]*)⟧$/u;

export interface EncodedMemory {
  /** The exact string written to Walrus Memory. */
  memoryText: string;
  /** The normalized fact sentence (what embeddings and humans see). */
  factText: string;
}

/**
 * Builds `<fact sentence>\n⟦ferry:v1 k=v ...⟧`. The sentence is normalized, and a fact containing
 * header brackets is refused, so no fact can smuggle a second header past `decodeMemory`.
 */
export function encodeMemory(fact: string, header: FerryHeader): EncodedMemory {
  const parsed = FerryHeader.parse(header);
  const { text, hadHeaderBrackets } = normalizeFactText(fact);
  // Screening quarantines these upstream; refusing here too means no code path can write one.
  if (hadHeaderBrackets) throw new Error('encodeMemory: HEADER_FORGERY');
  if (text.length === 0) throw new Error('encodeMemory: empty fact after normalization');
  const fields = [
    `t=${parsed.type}`,
    `s=${parsed.sources.join(',')}`,
    `c=${parsed.convHash}`,
    `at=${parsed.at}`,
    `cf=${parsed.confidence.toFixed(2)}`,
    `q=${parsed.quoteHash}`,
    `sup=${parsed.supersedes ?? '-'}`,
    `st=${parsed.status}`,
  ];
  return { memoryText: `${text}\n${PREFIX}${fields.join(' ')}${CLOSE}`, factText: text };
}

export type DecodeResult =
  | { ok: true; factText: string; header: FerryHeader }
  | { ok: false; reason: 'no_header' | 'invalid_header'; factText: string };

/** Parses memory text written by `encodeMemory`. Memories written by other tools decode as `no_header`. */
export function decodeMemory(memoryText: string): DecodeResult {
  const match = HEADER_LINE.exec(memoryText);
  if (!match || match[1] === undefined) {
    return { ok: false, reason: 'no_header', factText: normalizeFactText(memoryText).text };
  }
  const factText = memoryText.slice(0, match.index);
  const kv = new Map<string, string>();
  for (const pair of match[1].split(' ')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) return { ok: false, reason: 'invalid_header', factText };
    const key = pair.slice(0, eq);
    if (kv.has(key)) return { ok: false, reason: 'invalid_header', factText };
    kv.set(key, pair.slice(eq + 1));
  }
  const sup = kv.get('sup');
  const candidate = {
    v: 1,
    type: kv.get('t') as FactType | undefined,
    sources: (kv.get('s') ?? '').split(',') as Vendor[],
    convHash: kv.get('c'),
    at: kv.get('at'),
    confidence: Number(kv.get('cf')),
    quoteHash: kv.get('q'),
    supersedes: sup === '-' ? null : sup,
    status: kv.get('st'),
  };
  const parsed = FerryHeader.safeParse(candidate);
  if (!parsed.success || factText.includes(OPEN) || factText.includes(CLOSE)) {
    return { ok: false, reason: 'invalid_header', factText };
  }
  return { ok: true, factText, header: parsed.data };
}
