import { DistillRequest, MAX_CHUNK_CHARS, MAX_DISTILL_CHUNKS } from '@ferry/core';
import { describe, expect, it } from 'vitest';
import { batchChunks, chunkConversation, indexSources, locateQuote } from './chunk.js';
import { canonicalize } from './jcs.js';
import { splitPasteCandidates } from './paste.js';
import { cleanText, htmlToText, safeCut, splitText, tail } from './text.js';
import { epochSecondsToMs, isoToMs, parseTakeoutDate } from './time.js';
import type { NormalizedConversation } from './types.js';
import { conversationUrl } from './urls.js';
import { createTicker, yieldToEventLoop } from './yield.js';

const AT = Date.UTC(2025, 0, 1);

function conversation(texts: string[], extra: Partial<NormalizedConversation> = {}): NormalizedConversation {
  return {
    vendor: 'chatgpt',
    id: 'conv-1',
    title: 'T',
    url: 'https://chatgpt.com/c/conv-1',
    turns: texts.map((text, i) => ({ text, at: AT + i * 1000 })),
    ...extra,
  };
}

describe('text', () => {
  it('cleans control characters and newlines', () => {
    expect(cleanText(' a\r\nb\u0000c\u0007\r ')).toBe('a\nbc');
  });

  it('cuts tails and splits without breaking surrogate pairs', () => {
    const emoji = '\u{1F600}';
    expect(tail(`a${emoji}`, 1)).toBe('');
    expect(tail('abc', 5)).toBe('abc');
    expect(safeCut(`a${emoji}`, 2)).toBe(1);
    expect(safeCut('abc', 10)).toBe(3);
    const pieces = splitText(`${emoji.repeat(10)}`, 5);
    expect(pieces.join('')).toBe(emoji.repeat(10));
    expect(pieces.every((p) => p.length <= 5)).toBe(true);
  });

  it('prefers paragraph, then sentence, then word boundaries', () => {
    expect(splitText('aaaa aaaa\n\nbbbb', 12)).toEqual(['aaaa aaaa', 'bbbb']);
    expect(splitText('One two. Three four five', 12)).toEqual(['One two.', 'Three four', 'five']);
    expect(splitText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('strips HTML to text without executing or keeping script and style bodies', () => {
    expect(htmlToText('<p>Hi&nbsp;<b>there</b></p><script>x()</script><STYLE>p{}</STYLE>&#65;&#x42;&bogus;&#0;')).toBe('Hi there\nAB&bogus;');
    expect(htmlToText('before<script>never closed')).toBe('before');
    expect(htmlToText('a<script>x</script')).toBe('a');
  });
});

describe('time', () => {
  it('rejects placeholder and garbage timestamps', () => {
    expect(epochSecondsToMs(0)).toBeNull();
    expect(epochSecondsToMs(null)).toBeNull();
    expect(epochSecondsToMs(Number.NaN)).toBeNull();
    expect(epochSecondsToMs(1735725600.5)).toBe(1735725600500);
    expect(isoToMs('2025-01-01')).toBeNull();
    expect(isoToMs('2025-01-01T00:00:00+0100')).toBe(Date.UTC(2024, 11, 31, 23));
    expect(isoToMs(42)).toBeNull();
  });

  it('parses Takeout HTML dates', () => {
    expect(parseTakeoutDate('Jan 2, 2025, 12:00:00 AM UTC')).toBe(Date.UTC(2025, 0, 2, 0));
    expect(parseTakeoutDate('Jan 2, 2025, 12:30:00\u202FPM GMT-5')).toBe(Date.UTC(2025, 0, 2, 17, 30));
    expect(parseTakeoutDate('2 Sept 2025, 10:00:00 GMT+05:30')).toBe(Date.UTC(2025, 8, 2, 4, 30));
    expect(parseTakeoutDate('Foo 2, 2025, 12:00:00 AM UTC')).toBeNull();
    expect(parseTakeoutDate('Jan 2, 2025, 12:00:00 AM constructor')).toBeNull();
    expect(parseTakeoutDate('yesterday')).toBeNull();
  });
});

describe('urls', () => {
  it('only builds links from safe ids', () => {
    expect(conversationUrl('claude', 'abc-123')).toBe('https://claude.ai/chat/abc-123');
    expect(conversationUrl('chatgpt', '../evil')).toBeNull();
    expect(conversationUrl('gemini', 'x'.repeat(65))).toBeNull();
  });
});

describe('paste', () => {
  it('splits a typical "what do you know about me" answer', () => {
    const text = [
      '## What I know about you',
      '',
      '**Work:**',
      '- You are a **synthetic** product designer.',
      '* You prefer dark mode.',
      '1. You live in Exampleville.',
      '\u2022 You prefer dark mode.',
      'ok',
      `${'A long sentence about you. '.repeat(15)}Another claim!`,
    ].join('\n');
    expect(splitPasteCandidates(text)).toEqual([
      'What I know about you',
      'You are a synthetic product designer.',
      'You prefer dark mode.',
      'You live in Exampleville.',
      'A long sentence about you.',
      'Another claim!',
    ]);
  });
});

describe('chunkConversation', () => {
  it('groups consecutive turns into valid Distill chunks with a side table', async () => {
    const conv = conversation(['first fact', 'second fact']);
    conv.turns[0] = { ...conv.turns[0], text: 'first fact', at: AT, assistantContext: 'ctx' };
    const out = await chunkConversation(conv);
    expect(out?.chunks).toHaveLength(1);
    const [chunk] = out?.chunks ?? [];
    expect(chunk?.userText).toBe('first fact\n\nsecond fact');
    expect(chunk?.assistantContext).toBe('ctx');
    expect(chunk?.messageAt).toBe('2025-01-01T00:00:00.000Z');
    expect(chunk?.chunkId).toMatch(/^chatgpt_[A-Za-z0-9_-]{16}_0$/);
    expect(DistillRequest.safeParse({ chunks: out?.chunks }).success).toBe(true);
    const [source] = out?.sources ?? [];
    expect(source).toMatchObject({ conversationId: 'conv-1', conversationTitle: 'T', rawUserText: chunk?.userText });
    expect(locateQuote(source as never, 'second fact')).toBe('2025-01-01T00:00:01.000Z');
    expect(locateQuote(source as never, 'not there')).toBe(source?.messageAt);
    expect(locateQuote(source as never, '')).toBe(source?.messageAt);
    expect(indexSources(out?.sources ?? []).get(chunk?.chunkId ?? '')).toBe(source);
  });

  it('starts a new chunk at the size limit and splits oversized turns', async () => {
    const big = 'word '.repeat(2000).trim();
    const out = await chunkConversation(conversation(['short', big, 'tail']));
    const chunks = out?.chunks ?? [];
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.every((c) => c.userText.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.map((c) => c.chunkId.split('_').at(-1))).toEqual(chunks.map((_, i) => String(i)));
    expect(DistillRequest.safeParse({ chunks: chunks.slice(0, MAX_DISTILL_CHUNKS) }).success).toBe(true);
  });

  it('is deterministic and skips unusable conversation ids', async () => {
    const a = await chunkConversation(conversation(['x y z']));
    const b = await chunkConversation(conversation(['x y z']));
    expect(a?.chunks[0]?.chunkId).toBe(b?.chunks[0]?.chunkId);
    expect(await chunkConversation(conversation(['x'], { id: '' }))).toBeNull();
    expect(await chunkConversation(conversation(['x'], { id: 'i'.repeat(201) }))).toBeNull();
    expect(await chunkConversation(conversation([]))).toEqual({ chunks: [], sources: [] });
  });
});

describe('batchChunks', () => {
  it('batches by MAX_DISTILL_CHUNKS and validates size', () => {
    const items = Array.from({ length: 35 }, (_, i) => i);
    expect(batchChunks(items).map((b) => b.length)).toEqual([16, 16, 3]);
    expect(batchChunks(items, 10)).toHaveLength(4);
    expect(batchChunks([])).toEqual([]);
    expect(() => batchChunks(items, 0)).toThrow(RangeError);
    expect(() => batchChunks(items, 17)).toThrow(RangeError);
  });
});

describe('yield', () => {
  it('yields after the budget and reports aborts', async () => {
    const controller = new AbortController();
    const tick = createTicker(0, controller.signal);
    expect(await tick()).toBe(false);
    controller.abort();
    expect(await tick()).toBe(true);
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
  });

  it('uses scheduler.yield when the platform has it', async () => {
    let called = 0;
    Reflect.set(globalThis, 'scheduler', { yield: () => { called += 1; return Promise.resolve(); } });
    try {
      await yieldToEventLoop();
    } finally {
      Reflect.deleteProperty(globalThis, 'scheduler');
    }
    expect(called).toBe(1);
  });
});

describe('canonicalize (RFC 8785)', () => {
  it('sorts keys, drops undefined, and serializes numbers the ECMAScript way', () => {
    expect(canonicalize({ b: 1, a: [true, null, undefined, 'x'], c: undefined, z: 1.0, y: 1e21 })).toBe(
      '{"a":[true,null,null,"x"],"b":1,"y":1e+21,"z":1}',
    );
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
  });
});
