/** Max assistant context per chunk (DistillRequest contract). */
export const MAX_ASSISTANT_CONTEXT = 1000;

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Plain text as the user wrote it: unified newlines, no control bytes, trimmed. */
export function cleanText(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
}

/** Key for "is this the same user text": case and whitespace insensitive. */
export function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Last `max` UTF-16 units, never starting on half a surrogate pair. The end of a reply is what the user answered. */
export function tail(text: string, max: number = MAX_ASSISTANT_CONTEXT): string {
  if (text.length <= max) return text;
  let start = text.length - max;
  if (isLowSurrogate(text.charCodeAt(start))) start += 1;
  return text.slice(start);
}

/** Index at or below `limit` that does not split a surrogate pair. */
export function safeCut(text: string, limit: number): number {
  if (limit >= text.length) return text.length;
  return isLowSurrogate(text.charCodeAt(limit)) ? limit - 1 : limit;
}

/**
 * Splits text into pieces of at most `max` units, preferring paragraph, then sentence, then word
 * boundaries in the back half of each window so pieces stay readable for the distiller.
 */
export function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, safeCut(rest, max));
    const floor = Math.floor(window.length / 2);
    let cut = window.lastIndexOf('\n\n');
    if (cut < floor) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! ')) + 1;
    if (cut < floor) cut = window.lastIndexOf(' ');
    if (cut < floor) cut = window.length;
    const piece = rest.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  emsp: ' ',
  ensp: ' ',
  thinsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? (NAMED_ENTITIES[body] ?? whole) : whole;
  });
}

/** Removes script and style bodies with an indexOf scan: a lazy regex here would go quadratic on hostile input. */
function dropRawTextElements(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let pos = 0;
  for (;;) {
    const script = lower.indexOf('<script', pos);
    const style = lower.indexOf('<style', pos);
    const open = script === -1 ? style : style === -1 ? script : Math.min(script, style);
    if (open === -1) break;
    const tag = open === script ? '</script' : '</style';
    const close = lower.indexOf(tag, open);
    out += html.slice(pos, open) + ' ';
    if (close === -1) return out;
    const end = lower.indexOf('>', close);
    pos = end === -1 ? html.length : end + 1;
  }
  return out + html.slice(pos);
}

/**
 * Text content of an HTML fragment without a DOM. Workers have no DOMParser, and the result is
 * only ever used as plain text, so a linear tag strip is enough and never executes markup.
 */
export function htmlToText(html: string): string {
  const withBreaks = dropRawTextElements(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|pre|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return cleanText(
    decodeEntities(withBreaks)
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property string read, so `__proto__` style keys in hostile JSON never reach the prototype. */
export function str(record: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function field(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
