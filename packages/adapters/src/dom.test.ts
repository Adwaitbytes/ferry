import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanUserText, fallbackTheme, insertTextAtStart, isHTMLElement, plainText, readDraft, themeFromClasses } from './dom.js';
import { h } from './testing/contract.js';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

describe('plainText', () => {
  it('turns blocks and breaks into lines and skips code and hidden labels', () => {
    const root = h(document, 'div', {}, [
      h(document, 'span', { class: 'sr-only' }, ['You said:']),
      h(document, 'p', {}, ['one', h(document, 'b', {}, [' bold'])]),
      h(document, 'p', {}, [h(document, 'br')]),
      h(document, 'p', {}, ['two', h(document, 'br'), 'three']),
      h(document, 'script', {}, ['alert(1)']),
      h(document, 'button', {}, ['Copy']),
      document.createComment('ignored'),
    ]);
    expect(plainText(root)).toBe('one bold\n\ntwo\nthree');
  });
});

describe('cleanUserText', () => {
  it('strips invisible characters and bidi controls', () => {
    expect(cleanUserText('  a\u200Bb\u202Ec\u2066d\uFEFF  ')).toBe('abcd');
  });
});

describe('isHTMLElement', () => {
  it('rejects SVG elements', () => {
    expect(isHTMLElement(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))).toBe(false);
    expect(isHTMLElement(document.createElement('div'))).toBe(true);
  });
});

describe('insertTextAtStart', () => {
  it('prepends to a React-style textarea through the prototype setter and fires input', () => {
    const area = h(document, 'textarea') as HTMLTextAreaElement;
    area.value = 'draft';
    document.body.appendChild(area);
    const seen: string[] = [];
    area.addEventListener('input', () => seen.push(area.value));
    expect(insertTextAtStart(area, 'ctx ')).toBe(true);
    expect(readDraft(area)).toBe('ctx draft');
    expect(seen).toEqual(['ctx draft']);
    expect(area.selectionStart).toBe(4);
  });

  it('is a no-op for empty text', () => {
    const div = h(document, 'div', { contenteditable: 'true' }, ['x']);
    expect(insertTextAtStart(div, '')).toBe(true);
    expect(readDraft(div)).toBe('x');
  });

  it('refuses a non-editable element', () => {
    const div = h(document, 'div', {}, ['x']);
    document.body.appendChild(div);
    expect(insertTextAtStart(div, 'y')).toBe(false);
    expect(readDraft(div)).toBe('x');
  });

  it('lets an editor that handles beforeinput do the insertion itself', () => {
    const div = h(document, 'div', { contenteditable: 'true' }, [h(document, 'p', {}, ['draft'])]);
    document.body.appendChild(div);
    div.addEventListener('beforeinput', (event) => {
      event.preventDefault();
      const data = (event as InputEvent).data ?? '';
      div.firstElementChild?.prepend(document.createTextNode(data));
    });
    expect(insertTextAtStart(div, 'ctx ')).toBe(true);
    expect(readDraft(div)).toBe('ctx draft');
  });

  it('inserts into an empty contenteditable root', () => {
    const div = h(document, 'div', { contenteditable: '' });
    document.body.appendChild(div);
    expect(insertTextAtStart(div, 'hello')).toBe(true);
    expect(readDraft(div)).toBe('hello');
  });

  it('fails cleanly without a selection', () => {
    const div = h(document, 'div', { contenteditable: 'true' }, ['x']);
    document.body.appendChild(div);
    vi.spyOn(document, 'getSelection').mockReturnValue(null);
    expect(insertTextAtStart(div, 'y')).toBe(false);
  });
});

describe('theme helpers', () => {
  it('reads color-scheme, then the OS preference', () => {
    document.documentElement.style.setProperty('color-scheme', 'dark');
    expect(fallbackTheme(document)).toBe('dark');
    document.documentElement.style.setProperty('color-scheme', 'light');
    expect(fallbackTheme(document)).toBe('light');
    document.documentElement.removeAttribute('style');
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true });
    expect(fallbackTheme(document)).toBe('dark');
    matchMedia.mockReturnValue({ matches: false });
    expect(fallbackTheme(document)).toBe('light');
    Reflect.deleteProperty(window, 'matchMedia');
    expect(fallbackTheme(document)).toBe('light');
  });

  it('works on a document without a window', () => {
    const doc = document.implementation.createHTMLDocument('x');
    expect(fallbackTheme(doc)).toBe('light');
  });

  it('returns undefined without an explicit class', () => {
    expect(themeFromClasses(null, 'dark', 'light')).toBeUndefined();
    expect(themeFromClasses(document.body, 'dark', 'light')).toBeUndefined();
  });
});
