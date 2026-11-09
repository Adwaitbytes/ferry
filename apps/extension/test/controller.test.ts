// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_PAUSE_MS, startFerry, type FerryContent } from '../src/content/controller';
import { fakeSend, textareaAdapter } from './content-fixtures';

let ferry: FerryContent | null = null;
let shadow: ShadowRoot | null = null;

beforeEach(() => {
  document.body.textContent = '';
  const area = document.createElement('textarea');
  area.id = 'composer';
  document.body.append(area);
  // The UI root is closed; capture it at creation so the test can look inside.
  const original = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    shadow = original.call(this, init);
    return shadow;
  });
  vi.useFakeTimers();
});

afterEach(() => {
  ferry?.destroy();
  ferry = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function type(text: string) {
  const area = document.querySelector('textarea') as HTMLTextAreaElement;
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return area;
}

describe('composer chip and insert', () => {
  it('shows the chip after a typing pause and inserts the delimited block at the start', async () => {
    const send = fakeSend();
    ferry = startFerry({
      site: 'claude',
      adapter: textareaAdapter(document),
      doc: document,
      send,
      cssText: '',
      fontUrl: 'chrome-extension://x/fonts/f.woff2',
    });
    const area = type('plan dinner for friday');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS - 1);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'recall.suggest' }));
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledWith({
      type: 'recall.suggest',
      site: 'claude',
      draft: 'plan dinner for friday',
    });

    const chip = shadow?.querySelector<HTMLButtonElement>('.ferry-chip');
    expect(chip?.textContent).toContain('Ferry has 2 things Claude should know');
    expect(chip?.getAttribute('aria-expanded')).toBe('false');
    expect(chip?.getBoundingClientRect).toBeDefined();

    chip?.click();
    const preview = shadow?.querySelector('.ferry-preview');
    expect(preview?.textContent).toContain('Add context to this message');
    const boxes = shadow?.querySelectorAll<HTMLInputElement>('.ferry-fact input') ?? [];
    expect(boxes).toHaveLength(2);
    boxes[1]?.click();
    const insert = Array.from(shadow?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Insert 1 fact',
    );
    insert?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith({
      type: 'inject.compose',
      site: 'claude',
      refs: ['blob-aaaaaaaa1'],
    });
    expect(area.value).toBe('[ctx]\n- Vegetarian\n[end]\n\nplan dinner for friday');
    expect(shadow?.querySelector('.ferry-chip')?.textContent).toContain('Added 1 fact');
  });

  it('Esc dismisses the chip for this composer session', async () => {
    const send = fakeSend();
    ferry = startFerry({
      site: 'claude',
      adapter: textareaAdapter(document),
      doc: document,
      send,
      cssText: '',
      fontUrl: 'x',
    });
    type('plan dinner for friday');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    expect(shadow?.querySelector('.ferry-chip')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shadow?.querySelector('.ferry-chip')).toBeNull();
    type('plan dinner for saturday');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    expect(shadow?.querySelector('.ferry-chip')).toBeNull();
  });

  it('Alt+I from the worker inserts every suggestion', async () => {
    const send = fakeSend();
    ferry = startFerry({
      site: 'claude',
      adapter: textareaAdapter(document),
      doc: document,
      send,
      cssText: '',
      fontUrl: 'x',
    });
    type('plan dinner');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    await ferry.insertSuggested();
    expect(send).toHaveBeenCalledWith({
      type: 'inject.compose',
      site: 'claude',
      refs: ['blob-aaaaaaaa1', 'blob-aaaaaaaa2'],
    });
  });

  it('shows a quiet degraded indicator instead of throwing when the adapter breaks', () => {
    vi.useFakeTimers();
    const adapter = textareaAdapter(document);
    adapter.health = () => ({ ok: false, detail: 'composer not found' });
    adapter.findComposer = () => {
      throw new Error('selector exploded');
    };
    const send = fakeSend();
    expect(() => {
      ferry = startFerry({
        site: 'claude',
        adapter,
        doc: document,
        send,
        cssText: '',
        fontUrl: 'x',
      });
    }).not.toThrow();
    // One failure right after load is treated as hydration; the pill needs a second failure.
    expect(shadow?.querySelector('.ferry-degraded')).toBeFalsy();
    vi.advanceTimersByTime(3_000);
    vi.useRealTimers();
    expect(send).toHaveBeenCalledWith({
      type: 'adapter.health',
      site: 'claude',
      ok: false,
      detail: 'composer not found',
    });
    expect(shadow?.querySelector('.ferry-degraded')?.textContent).toBe('Ferry adapter degraded');
  });

  it('sets the host theme from the site and keeps the shadow root closed', async () => {
    ferry = startFerry({
      site: 'claude',
      adapter: textareaAdapter(document),
      doc: document,
      send: fakeSend(),
      cssText: '',
      fontUrl: 'x',
    });
    type('plan dinner');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    const host = document.querySelector('ferry-ui');
    expect(host?.getAttribute('data-theme')).toBe('dark');
    expect(host?.shadowRoot).toBeNull();
    expect(document.getElementById('ferry-fonts')?.textContent).toContain("'Ferry Geist'");
  });
});

describe('insert from the side panel', () => {
  it('composes the requested refs through inject.compose and reports the count', async () => {
    const send = fakeSend();
    ferry = startFerry({
      site: 'claude',
      adapter: textareaAdapter(document),
      doc: document,
      send,
      cssText: '',
      fontUrl: 'x',
    });
    const area = type('plan dinner for friday');
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
    expect(await ferry.insertRefs(['blob-aaaaaaaa2'])).toBe(1);
    expect(send).toHaveBeenCalledWith({
      type: 'inject.compose',
      site: 'claude',
      refs: ['blob-aaaaaaaa2'],
    });
    expect(area.value.startsWith('[ctx]')).toBe(true);
  });

  it('reports 0 when there is no composer', async () => {
    const adapter = textareaAdapter(document);
    adapter.findComposer = () => null;
    const send = fakeSend();
    ferry = startFerry({ site: 'claude', adapter, doc: document, send, cssText: '', fontUrl: 'x' });
    expect(await ferry.insertRefs(['blob-aaaaaaaa1'])).toBe(0);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'inject.compose' }));
  });
});
