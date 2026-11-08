import { afterEach, describe, expect, it, vi } from 'vitest';
import { guard, reportAdapterError, setAdapterErrorReporter } from './errors.js';
import { observeDebounced } from './observe.js';
import { adapterFor } from './registry.js';
import { chatgptAdapter } from './sites/chatgpt.js';
import { claudeAdapter } from './sites/claude.js';
import { geminiAdapter } from './sites/gemini.js';

afterEach(() => {
  setAdapterErrorReporter(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('error containment', () => {
  it('warns through the default reporter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportAdapterError('ctx', new Error('boom'));
    expect(warn).toHaveBeenCalledWith('ferry adapter: ctx', expect.any(Error));
  });

  it('swallows a reporter that itself throws', () => {
    setAdapterErrorReporter(() => {
      throw new Error('reporter bug');
    });
    expect(() => reportAdapterError('ctx', 1)).not.toThrow();
  });

  it('guard returns the fallback and reports', () => {
    const seen: string[] = [];
    setAdapterErrorReporter((context) => seen.push(context));
    expect(guard('thing', 7, () => { throw new Error('x'); })).toBe(7);
    expect(seen).toEqual(['thing']);
  });

  it('adapter entry points never throw into the page', () => {
    const seen: string[] = [];
    setAdapterErrorReporter((context) => seen.push(context));
    const broken = { querySelectorAll: () => { throw new Error('dom gone'); } } as unknown as Document;
    expect(chatgptAdapter.findComposer(broken)).toBeNull();
    expect(chatgptAdapter.health(broken)).toEqual({ ok: false, detail: 'adapter degraded: health check failed' });
    expect(chatgptAdapter.probe(broken)).toEqual({ composer: null, userTurns: null });
    expect(typeof chatgptAdapter.observeUserMessages(broken, () => undefined)).toBe('function');
    const badEl = { tagName: 'DIV', getAttribute: () => { throw new Error('x'); } } as unknown as HTMLElement;
    expect(chatgptAdapter.insertAtStart(badEl, 'x')).toBe(false);
    expect(chatgptAdapter.readDraft({} as HTMLElement)).toBe('');
    expect(chatgptAdapter.anchorRect({} as HTMLElement)).toBeInstanceOf(DOMRect);
    expect(chatgptAdapter.theme({} as Document)).toBe('light');
    expect(chatgptAdapter.matches({} as URL)).toBe(false);
    expect(chatgptAdapter.conversationUrl({ protocol: 'https:', hostname: 'chatgpt.com', pathname: null } as unknown as Location)).toBeUndefined();
    expect(seen).toEqual(expect.arrayContaining(['findComposer', 'health', 'probe', 'observeUserMessages', 'insertAtStart', 'readDraft', 'anchorRect', 'theme']));
  });
});

describe('observeDebounced', () => {
  it('coalesces bursts into one flush and contains flush errors', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const seen: string[] = [];
    setAdapterErrorReporter((context) => seen.push(context));
    let flushes = 0;
    const stop = observeDebounced(document.body, () => {
      flushes += 1;
      throw new Error('flush bug');
    }, { delayMs: 100 });
    for (let i = 0; i < 5; i += 1) {
      document.body.appendChild(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(flushes).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(flushes).toBe(1);
    expect(seen).toEqual(['observeDebounced.flush']);
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(flushes).toBe(1);
  });

  it('degrades to a no-op without MutationObserver', () => {
    const seen: string[] = [];
    setAdapterErrorReporter((context) => seen.push(context));
    vi.stubGlobal('MutationObserver', undefined);
    const stop = observeDebounced(document.body, () => undefined);
    expect(stop()).toBeUndefined();
    expect(seen).toEqual(['observeDebounced']);
  });
});

describe('adapterFor', () => {
  it('maps each exact host and rejects everything else', () => {
    expect(adapterFor('https://chatgpt.com/c/x')).toBe(chatgptAdapter);
    expect(adapterFor(new URL('https://claude.ai/new'))).toBe(claudeAdapter);
    expect(adapterFor('https://gemini.google.com/app')).toBe(geminiAdapter);
    expect(adapterFor('https://www.perplexity.ai/')).toBeUndefined();
    expect(adapterFor('not a url')).toBeUndefined();
  });
});

describe('theme fallbacks', () => {
  it('claude falls back to the dark class, then color-scheme', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.documentElement.classList.add('dark');
    expect(claudeAdapter.theme(doc)).toBe('dark');
    doc.documentElement.classList.remove('dark');
    doc.documentElement.style.setProperty('color-scheme', 'dark');
    expect(claudeAdapter.theme(doc)).toBe('dark');
    expect(chatgptAdapter.theme(doc)).toBe('dark');
    expect(geminiAdapter.theme(doc)).toBe('dark');
  });
});
