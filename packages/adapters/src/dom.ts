import type { SelectorStrategy, StrategyMatch, Theme } from './types.js';

/** Same cap as `capture.propose.userText` in core contracts. */
export const MAX_USER_TEXT_CHARS = 8000;

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
]);
/** Never part of what the user typed: code, styling, controls and screen-reader labels. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BUTTON', 'SVG', 'IMG', 'TEXTAREA', 'INPUT']);
const SKIP_CLASSES = ['sr-only', 'cdk-visually-hidden'];

// Invisible code points that carry no meaning in a chat turn. Core normalization strips a
// wider set before anything is saved; this keeps adapter output stable for dedupe keys.
const INVISIBLE = new RegExp('[\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\u202A-\\u202E\\u2066-\\u2069]', 'gu');

function isSkipped(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
  return SKIP_CLASSES.some((name) => el.classList.contains(name));
}

/**
 * Reads text the way a user sees it: block elements and `<br>` become line breaks. Reads
 * text nodes only, so markup inside page content is never parsed or executed.
 */
export function plainText(root: Node): string {
  let out = '';
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? '';
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isSkipped(el)) continue;
      const tag = el.tagName.toUpperCase();
      if (tag === 'BR') {
        out += '\n';
      } else if (BLOCK_TAGS.has(tag)) {
        if (out !== '' && !out.endsWith('\n')) out += '\n';
        walk(el);
        if (!out.endsWith('\n')) out += '\n';
      } else {
        walk(el);
      }
    }
  };
  walk(root);
  return out.replace(/\n+$/u, '');
}

/** Plain text of a user turn: invisible characters removed, trimmed, capped. */
export function cleanUserText(raw: string): string {
  const text = raw.replace(INVISIBLE, '').trim();
  const chars = Array.from(text);
  return chars.length > MAX_USER_TEXT_CHARS ? chars.slice(0, MAX_USER_TEXT_CHARS).join('') : text;
}

/** Drops matches nested inside another match, so one turn is never counted twice. */
function outermost<T extends Element>(elements: T[]): T[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

/**
 * Tries each strategy in order and returns the first that yields at least one element
 * accepted by `accept`. Index 0 is the primary strategy; any later match is a fallback.
 */
export function matchStrategies<T extends Element>(
  root: ParentNode,
  strategies: readonly SelectorStrategy[],
  accept: (el: Element) => el is T,
): StrategyMatch<T> | null {
  for (const [index, strategy] of strategies.entries()) {
    const found = outermost(Array.from(root.querySelectorAll(strategy.selector)).filter(accept));
    if (found.length > 0) return { strategy: strategy.name, fallback: index > 0, elements: found };
  }
  return null;
}

export function isHTMLElement(el: Element): el is HTMLElement {
  return el.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function isTextControl(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  const tag = el.tagName.toUpperCase();
  return tag === 'TEXTAREA' || tag === 'INPUT';
}

export function isEditableRoot(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value === '' || value === 'true' || value === 'plaintext-only';
}

export function readDraft(composer: HTMLElement): string {
  if (isTextControl(composer)) return composer.value;
  return plainText(composer);
}

const collapseWs = (s: string): string => s.replace(/\s+/gu, ' ').trim();

function landedAtStart(composer: HTMLElement, text: string, before: string): boolean {
  return collapseWs(readDraft(composer)) === collapseWs(text + before);
}

function makeInputEvent(type: 'beforeinput' | 'input', text: string, cancelable: boolean): Event {
  const init = { bubbles: true, cancelable, composed: true, inputType: 'insertText', data: text };
  return typeof InputEvent === 'function' ? new InputEvent(type, init) : new Event(type, init);
}

function insertIntoTextControl(el: HTMLTextAreaElement | HTMLInputElement, text: string, before: string): boolean {
  // React tracks the instance's value property; the prototype setter bypasses that tracker
  // so the following input event is seen as a real change and state updates.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, 'value')?.set;
  if (setter) setter.call(el, text + before);
  else el.value = text + before;
  el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(makeInputEvent('input', text, false));
  return el.value === text + before;
}

/** Puts a collapsed caret at the very first text position inside `root`. */
function caretAtStart(root: HTMLElement): Range | null {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return null;
  let node: Node = root;
  while (node.firstChild && !(node.firstChild.nodeType === 1 && (node.firstChild as Element).tagName.toUpperCase() === 'BR')) {
    node = node.firstChild;
  }
  const range = doc.createRange();
  range.setStart(node, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function textFragment(doc: Document, text: string): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  text.split('\n').forEach((line, i) => {
    if (i > 0) fragment.appendChild(doc.createElement('br'));
    if (line !== '') fragment.appendChild(doc.createTextNode(line));
  });
  return fragment;
}

type ExecCommand = (command: string, showUi: boolean, value: string) => boolean;

/**
 * Inserts `text` before the current draft of a controlled editor. Order of attempts:
 * 1. `execCommand('insertText')` at a collapsed caret: Chrome then fires trusted
 *    beforeinput and input, which ProseMirror, Quill and React all handle natively.
 * 2. A cancelable synthetic `beforeinput`, for editors that implement insertion themselves.
 * 3. Text nodes inserted at the caret plus an `input` event; ProseMirror's DOM observer
 *    and Quill's mutation observer both reconcile such changes into their models.
 * HTML is never parsed: only text nodes and `<br>` elements are created.
 */
export function insertTextAtStart(composer: HTMLElement, text: string): boolean {
  if (text === '') return true;
  const before = readDraft(composer);
  if (isTextControl(composer)) return insertIntoTextControl(composer, text, before);
  if (!isEditableRoot(composer)) return false;

  composer.focus();
  const doc = composer.ownerDocument;
  const range = caretAtStart(composer);
  if (!range) return false;

  const exec = (doc as Document & { execCommand?: ExecCommand }).execCommand;
  if (typeof exec === 'function' && exec.call(doc, 'insertText', false, text)) {
    if (readDraft(composer) !== before) return landedAtStart(composer, text, before);
  }

  const handledByEditor = !composer.dispatchEvent(makeInputEvent('beforeinput', text, true));
  if (handledByEditor) return landedAtStart(composer, text, before);

  const fresh = caretAtStart(composer) ?? range;
  fresh.insertNode(textFragment(doc, text));
  composer.dispatchEvent(makeInputEvent('input', text, false));
  return landedAtStart(composer, text, before);
}

/** Generic theme detection from `color-scheme`, then the OS preference. */
export function fallbackTheme(doc: Document): Theme {
  const root = doc.documentElement;
  const view = doc.defaultView;
  const scheme =
    root.style.getPropertyValue('color-scheme') || (view ? view.getComputedStyle(root).getPropertyValue('color-scheme') : '');
  if (scheme.includes('dark')) return 'dark';
  if (scheme.includes('light')) return 'light';
  if (view && typeof view.matchMedia === 'function' && view.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

/** `dark` or `light` if the class list of `el` says so explicitly. */
export function themeFromClasses(el: Element | null, dark: string, light: string): Theme | undefined {
  if (!el) return undefined;
  if (el.classList.contains(dark)) return 'dark';
  if (el.classList.contains(light)) return 'light';
  return undefined;
}
