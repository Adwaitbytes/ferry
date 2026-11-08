import type { NormalizedConversation, UserTurn } from './types.js';
import { cleanText, dedupeKey, field, htmlToText, isRecord, str, tail } from './text.js';
import { isoToMs, parseTakeoutDate, toIso } from './time.js';
import { conversationUrl } from './urls.js';

/** Takeout entries have no conversation id; prompts closer together than this form one session. */
const SESSION_GAP_MS = 30 * 60_000;

/**
 * Localized title prefixes Takeout puts before the prompt text ("Prompted How do I ..."). Titles
 * with any other prefix are activity records (feedback, settings), not prompts, unless the prefix
 * is learned from the file itself (see `learnPrefix`).
 */
const KNOWN_PREFIXES = ['Prompted ', 'Eingegebener Prompt: ', 'Prompt: '];

const CONVERSATION_PATH = /^\/app\/(?:c\/)?([A-Za-z0-9-]{1,64})$/;

/** Conversation id from a Takeout `titleUrl`, accepted only for the real Gemini host over https. */
function conversationIdFromUrl(raw: string | undefined): string | undefined {
  if (!raw || !URL.canParse(raw)) return undefined;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'gemini.google.com') return undefined;
  return CONVERSATION_PATH.exec(url.pathname)?.[1];
}

interface Exchange {
  prompt: string;
  at: number;
  response?: string;
  conversationId?: string;
}

/**
 * Takeout localizes "Prompted" per account language. When most titles share one short
 * "label: " prefix, that label is the prompt marker for this file.
 */
function learnPrefix(titles: string[]): string | null {
  // A file that already uses a known marker is in a known language; learning would only pick up noise like "Gave feedback: ".
  if (titles.some((t) => KNOWN_PREFIXES.some((p) => t.startsWith(p)))) return null;
  const counts = new Map<string, number>();
  for (const title of titles) {
    const colon = title.indexOf(': ');
    if (colon < 1 || colon > 40) continue;
    const prefix = title.slice(0, colon + 2);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }
  return best !== null && bestCount >= 2 && bestCount * 2 >= titles.length ? best : null;
}

function promptFromTitle(title: string, learned: string | null): string | null {
  for (const prefix of learned ? [...KNOWN_PREFIXES, learned] : KNOWN_PREFIXES) {
    if (title.startsWith(prefix)) return cleanText(title.slice(prefix.length));
  }
  return null;
}

function detailValue(entry: Record<string, unknown>, names: readonly string[]): string | undefined {
  const details = field(entry, 'details');
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (isRecord(detail) && names.includes(str(detail, 'name') ?? '')) {
      const value = str(detail, 'value');
      if (value) return value;
    }
  }
  return undefined;
}

/** First non-empty string anywhere inside a parsed JSON value, breadth first and bounded. */
function firstString(value: unknown): string | undefined {
  const queue: unknown[] = [value];
  for (let steps = 0; queue.length > 0 && steps < 1000; steps += 1) {
    const next = queue.shift();
    if (typeof next === 'string' && next.trim()) return next;
    if (Array.isArray(next)) queue.push(...next);
    else if (isRecord(next)) queue.push(...Object.values(next));
  }
  return undefined;
}

/** `userInteractions[].userInteraction.request` holds a JSON string, per the PAM provider notes. */
function interactionText(entry: Record<string, unknown>, key: 'request' | 'response'): string | undefined {
  const interactions = field(entry, 'userInteractions');
  if (!Array.isArray(interactions)) return undefined;
  for (const item of interactions) {
    const inner = isRecord(item) ? field(item, 'userInteraction') : undefined;
    const raw = isRecord(inner) ? str(inner, key) : undefined;
    if (!raw) continue;
    try {
      const text = firstString(JSON.parse(raw));
      if (text) return text;
    } catch {
      // Not JSON after all: the raw string is the text.
      return raw;
    }
  }
  return undefined;
}

function responseHtml(entry: Record<string, unknown>): string | undefined {
  const items = field(entry, 'safeHtmlItem');
  if (!Array.isArray(items)) return undefined;
  const html = items
    .filter(isRecord)
    .map((item) => str(item, 'html') ?? '')
    .join('\n');
  return html ? htmlToText(html) : undefined;
}

function exchangeFromJson(entry: unknown, learned: string | null): Exchange | null {
  if (!isRecord(entry)) return null;
  const at = isoToMs(field(entry, 'time'));
  if (at === null) return null;
  const title = str(entry, 'title') ?? '';
  const prompt =
    detailValue(entry, ['Request', 'Prompt']) ?? interactionText(entry, 'request') ?? promptFromTitle(title, learned);
  const text = prompt ? cleanText(prompt) : '';
  if (!text) return null;
  const exchange: Exchange = { prompt: text, at };
  const response = detailValue(entry, ['Response']) ?? interactionText(entry, 'response') ?? responseHtml(entry);
  if (response) exchange.response = cleanText(response);
  const conversationId = conversationIdFromUrl(str(entry, 'titleUrl'));
  if (conversationId) exchange.conversationId = conversationId;
  return exchange;
}

/** Groups exchanges by conversation id when Takeout has one, otherwise into time-gap sessions. */
function group(exchanges: Exchange[]): NormalizedConversation[] {
  exchanges.sort((a, b) => a.at - b.at);
  const byId = new Map<string, NormalizedConversation>();
  const sessions: NormalizedConversation[] = [];
  let session: NormalizedConversation | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  const seenPerConversation = new Map<NormalizedConversation, Set<string>>();
  const previousResponse = new Map<UserTurn, string>();
    for (const exchange of exchanges) {
    let conversation: NormalizedConversation;
    if (exchange.conversationId) {
      const existing = byId.get(exchange.conversationId);
      conversation = existing ?? {
        vendor: 'gemini',
        id: exchange.conversationId,
        title: null,
        url: conversationUrl('gemini', exchange.conversationId),
        turns: [],
      };
      if (!existing) byId.set(exchange.conversationId, conversation);
    } else {
      if (session === null || exchange.at - lastAt > SESSION_GAP_MS) {
        session = { vendor: 'gemini', id: `gemini-session-${toIso(exchange.at)}`, title: null, url: null, turns: [] };
        sessions.push(session);
      }
      lastAt = exchange.at;
      conversation = session;
    }
    const seen = seenPerConversation.get(conversation) ?? new Set<string>();
    seenPerConversation.set(conversation, seen);
    const key = dedupeKey(exchange.prompt);
    if (seen.has(key)) continue;
    seen.add(key);
    // Takeout pairs each prompt with its own response; the response before it is the context.
    const previous = conversation.turns.at(-1);
    const turn: UserTurn = { text: exchange.prompt, at: exchange.at };
    const context = previous ? previousResponse.get(previous) : undefined;
    if (context) turn.assistantContext = context;
    conversation.turns.push(turn);
    if (exchange.response) previousResponse.set(turn, tail(exchange.response));
  }
  const all = [...byId.values(), ...sessions];
  for (const conversation of all) conversation.title = conversation.turns[0]?.text.slice(0, 80) ?? null;
  return all;
}

/** Parses `My Activity/Gemini Apps/MyActivity.json`. */
export function parseGeminiJson(raw: unknown): NormalizedConversation[] | null {
  if (!Array.isArray(raw)) return null;
  const titles = raw.filter(isRecord).map((entry) => str(entry, 'title') ?? '');
  const learned = learnPrefix(titles);
  const exchanges: Exchange[] = [];
  for (const entry of raw) {
    const exchange = exchangeFromJson(entry, learned);
    if (exchange) exchanges.push(exchange);
  }
  return group(exchanges);
}

/**
 * Parses `My Activity/Gemini Apps/MyActivity.html`. Each entry is an "outer-cell" whose first
 * content cell reads: title line, timestamp line, then the response markup.
 */
export function parseGeminiHtml(html: string): NormalizedConversation[] {
  const cells = html.split(/<div class="outer-cell\b/).slice(1);
  const parsed: { title: string; at: number; response: string }[] = [];
  for (const cell of cells) {
    const start = cell.indexOf('content-cell');
    if (start === -1) continue;
    const bodyStart = cell.indexOf('>', start);
    const bodyEnd = cell.indexOf('<div class="content-cell', bodyStart);
    const body = cell.slice(bodyStart + 1, bodyEnd === -1 ? undefined : bodyEnd);
    const lines = body.split(/<br\s*\/?>/i);
    const dateIndex = lines.findIndex((line) => parseTakeoutDate(htmlToText(line)) !== null);
    if (dateIndex < 1) continue;
    parsed.push({
      title: htmlToText(lines.slice(0, dateIndex).join('<br>')),
      at: parseTakeoutDate(htmlToText(lines[dateIndex] as string)) as number,
      response: htmlToText(lines.slice(dateIndex + 1).join('<br>')),
    });
  }
  const learned = learnPrefix(parsed.map((p) => p.title));
  const exchanges: Exchange[] = [];
  for (const entry of parsed) {
    const prompt = promptFromTitle(entry.title, learned);
    if (!prompt) continue;
    const exchange: Exchange = { prompt, at: entry.at };
    if (entry.response) exchange.response = entry.response;
    exchanges.push(exchange);
  }
  return group(exchanges);
}
