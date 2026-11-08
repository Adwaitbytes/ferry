import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapterFor } from '../registry.js';
import { setAdapterErrorReporter } from '../errors.js';
import { DEFAULT_DEBOUNCE_MS } from '../observe.js';
import { MAX_USER_TEXT_CHARS } from '../dom.js';
import type { SentUserMessage, SiteAdapter, Theme } from '../types.js';

type Child = Node | string;

/** Builds an element through DOM APIs only. Strings become text nodes, never markup. */
export function h(doc: Document, tag: string, attrs: Record<string, string> = {}, children: Child[] = []): HTMLElement {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  for (const child of children) el.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  return el;
}

/** Loads a saved DOM snapshot into the jsdom document. Scripts in imported nodes never run. */
export function loadFixture(site: string, name: string): Document {
  // Test-only reader; site and name are literals from this package's own tests.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', site, `${name}.html`), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
  return document;
}

export interface ContractCase {
  adapter: SiteAdapter;
  fixtureDir: string;
  host: string;
  existingUserTexts: string[];
  draft: string;
  theme: Theme;
  newChatTheme: Theme;
  /** Flips the fixture's theme marker to the opposite of `theme`. */
  flipTheme(doc: Document): void;
  appendUserTurn(doc: Document, content: Child[]): void;
  /** Appends an assistant turn that also contains markup shaped like a user turn. */
  appendAssistantTurn(doc: Document, text: string): void;
  /** Strips primary markers from the composer so only a fallback strategy can find it. */
  degradeComposer(composer: HTMLElement): void;
  /** Strips primary markers from every user turn so only a fallback strategy can find them. */
  degradeUserTurns(doc: Document): void;
  conversationCases: ReadonlyArray<readonly [pathname: string, expected: string | undefined]>;
  newConversationPath: string;
}

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS + 50);
};

function typeInComposer(adapter: SiteAdapter, doc: Document): void {
  const composer = adapter.findComposer(doc);
  if (!composer) throw new Error('composer missing');
  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
}

export function runContractSuite(c: ContractCase): void {
  const { adapter } = c;

  describe(`${adapter.site} adapter contract`, () => {
    let doc: Document;
    let reported: string[];

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      history.replaceState(null, '', '/');
      doc = loadFixture(c.fixtureDir, 'conversation');
      reported = [];
      setAdapterErrorReporter((context) => reported.push(context));
    });

    afterEach(() => {
      setAdapterErrorReporter(null);
      vi.useRealTimers();
    });

    const observe = (): { sent: SentUserMessage[]; stop: () => void } => {
      const sent: SentUserMessage[] = [];
      const stop = adapter.observeUserMessages(doc, (msg) => sent.push(msg));
      return { sent, stop };
    };

    it('matches only the exact https host', () => {
      expect(adapter.matches(new URL(`https://${c.host}/`))).toBe(true);
      expect(adapter.matches(new URL(`http://${c.host}/`))).toBe(false);
      expect(adapter.matches(new URL(`https://${c.host}.evil.example/`))).toBe(false);
      expect(adapter.matches(new URL(`https://evil.example/${c.host}`))).toBe(false);
      expect(adapterFor(`https://${c.host}/anything`)).toBe(adapter);
    });

    it('reports healthy on the saved snapshot', () => {
      const health = adapter.health(doc);
      expect(health).toEqual({ ok: true, detail: expect.stringMatching(/^ok: composer via .+; user turns via .+$/) });
      const probe = adapter.probe(doc);
      expect(probe.composer?.fallback).toBe(false);
      expect(probe.userTurns?.fallback).toBe(false);
    });

    it('reports healthy with no user turns on a new chat', () => {
      doc = loadFixture(c.fixtureDir, 'new-chat');
      expect(adapter.health(doc)).toEqual({ ok: true, detail: expect.stringContaining('no user turns on page') });
      const composer = adapter.findComposer(doc);
      expect(composer).not.toBeNull();
      if (composer) expect(adapter.readDraft(composer)).toBe('');
    });

    it('reports degraded when the composer is only found by a fallback', () => {
      const composer = adapter.findComposer(doc);
      if (!composer) throw new Error('composer missing');
      c.degradeComposer(composer);
      const health = adapter.health(doc);
      expect(health.ok).toBe(false);
      expect(health.detail).toMatch(/^adapter degraded: composer found by fallback \(.+\)$/);
      expect(adapter.findComposer(doc)).toBe(composer);
    });

    it('reports degraded when user turns are only found by a fallback', () => {
      c.degradeUserTurns(doc);
      const health = adapter.health(doc);
      expect(health.ok).toBe(false);
      expect(health.detail).toMatch(/^adapter degraded: user turns found by fallback \(.+\)$/);
    });

    it('reports degraded when the composer is gone', () => {
      adapter.findComposer(doc)?.remove();
      expect(adapter.health(doc)).toEqual({ ok: false, detail: 'adapter degraded: composer not found' });
      expect(adapter.findComposer(doc)).toBeNull();
    });

    it('finds the composer and reads the draft', () => {
      const composer = adapter.findComposer(doc);
      expect(composer?.getAttribute('contenteditable')).toBe('true');
      if (composer) expect(adapter.readDraft(composer)).toBe(c.draft);
    });

    it('inserts at the start without losing the draft, through DOM text fallback', () => {
      const composer = adapter.findComposer(doc);
      if (!composer) throw new Error('composer missing');
      const inputs: Event[] = [];
      composer.addEventListener('input', (e) => inputs.push(e));
      const block = '[Context from my Ferry memory]\n- Allergic to cashews\n';
      expect(adapter.insertAtStart(composer, block)).toBe(true);
      expect(adapter.readDraft(composer)).toBe(`${block}${c.draft}`);
      expect(inputs).toHaveLength(1);
      expect(composer.querySelector('script')).toBeNull();
    });

    it('inserts at the start through execCommand when the browser supports it', () => {
      const composer = adapter.findComposer(doc);
      if (!composer) throw new Error('composer missing');
      const exec = vi.fn((command: string, _ui: boolean, value: string): boolean => {
        const range = doc.getSelection()?.getRangeAt(0);
        if (command !== 'insertText' || !range) return false;
        range.insertNode(doc.createTextNode(value));
        return true;
      });
      Object.defineProperty(doc, 'execCommand', { value: exec, configurable: true });
      try {
        expect(adapter.insertAtStart(composer, 'Prefix. ')).toBe(true);
        expect(adapter.readDraft(composer)).toBe(`Prefix. ${c.draft}`);
        expect(exec).toHaveBeenCalledOnce();
      } finally {
        Reflect.deleteProperty(doc, 'execCommand');
      }
    });

    it('treats inserted markup as literal text', () => {
      const composer = adapter.findComposer(doc);
      if (!composer) throw new Error('composer missing');
      expect(adapter.insertAtStart(composer, '<img src=x onerror=alert(1)> ')).toBe(true);
      expect(composer.querySelector('img')).toBeNull();
      expect(adapter.readDraft(composer)).toBe(`<img src=x onerror=alert(1)> ${c.draft}`);
    });

    it('fires once for a newly sent user turn and never for existing history', async () => {
      const { sent, stop } = observe();
      await settle();
      expect(sent).toEqual([]);

      typeInComposer(adapter, doc);
      c.appendUserTurn(doc, ['I prefer window seats.']);
      await settle();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toBe('I prefer window seats.');
      expect(sent[0]?.at).toBeInstanceOf(Date);

      doc.body.appendChild(h(doc, 'div', {}, ['unrelated mutation']));
      await settle();
      expect(sent).toHaveLength(1);
      stop();
    });

    it('never fires for assistant turns, including ones containing fake user markup', async () => {
      const { sent, stop } = observe();
      typeInComposer(adapter, doc);
      c.appendAssistantTurn(doc, 'Here is a plan.');
      await settle();
      expect(sent).toEqual([]);
      stop();
    });

    it('lists only real user turns from the snapshot', () => {
      const probe = adapter.probe(doc);
      expect(probe.userTurns?.elements).toHaveLength(c.existingUserTexts.length);
    });

    it('does not fire when a user turn appears without the user typing', async () => {
      const { sent, stop } = observe();
      c.appendUserTurn(doc, ['Loaded from elsewhere.']);
      await settle();
      expect(sent).toEqual([]);
      stop();
    });

    it('treats several turns appearing together as history, not a send', async () => {
      const { sent, stop } = observe();
      typeInComposer(adapter, doc);
      c.appendUserTurn(doc, ['Old message one.']);
      c.appendUserTurn(doc, ['Old message two.']);
      await settle();
      expect(sent).toEqual([]);
      stop();
    });

    it('does not fire after navigating into another conversation', async () => {
      const { sent, stop } = observe();
      typeInComposer(adapter, doc);
      history.pushState(null, '', '/elsewhere');
      c.appendUserTurn(doc, ['From another conversation.']);
      await settle();
      expect(sent).toEqual([]);
      stop();
    });

    it('fires for the first message of a new chat even as the URL changes', async () => {
      doc = loadFixture(c.fixtureDir, 'new-chat');
      const { sent, stop } = observe();
      typeInComposer(adapter, doc);
      history.pushState(null, '', c.newConversationPath);
      c.appendUserTurn(doc, ['My first message.']);
      await settle();
      expect(sent.map((m) => m.text)).toEqual(['My first message.']);
      stop();
    });

    it('waits for a user turn whose text renders after the node', async () => {
      const { sent, stop } = observe();
      typeInComposer(adapter, doc);
      const text = doc.createTextNode('');
      c.appendUserTurn(doc, [text]);
      await settle();
      expect(sent).toEqual([]);
      text.nodeValue = 'Rendered late.';
      await settle();
      expect(sent.map((m) => m.text)).toEqual(['Rendered late.']);
      stop();
    });

    it('stops observing when disposed', async () => {
      const { sent, stop } = observe();
      stop();
      typeInComposer(adapter, doc);
      c.appendUserTurn(doc, ['After stop.']);
      await settle();
      expect(sent).toEqual([]);
    });

    it('contains a throwing onSent callback', async () => {
      const stop = adapter.observeUserMessages(doc, () => {
        throw new Error('consumer bug');
      });
      typeInComposer(adapter, doc);
      c.appendUserTurn(doc, ['Hello.']);
      await settle();
      expect(reported).toContain('observeUserMessages.onSent');
      stop();
    });

    it('captures hostile user text as plain text', async () => {
      const { sent, stop } = observe();
      typeInComposer(adapter, doc);
      const script = h(doc, 'script', {}, ['window.pwned = true']);
      c.appendUserTurn(doc, ['<script>alert(1)</script> hi\u200B\u200D\uFEFF there', script]);
      await settle();
      expect(sent.map((m) => m.text)).toEqual(['<script>alert(1)</script> hi there']);
      expect((window as Window & { pwned?: boolean }).pwned).toBeUndefined();

      typeInComposer(adapter, doc);
      c.appendUserTurn(doc, ['a'.repeat(100_000)]);
      await settle();
      expect(sent).toHaveLength(2);
      expect(sent[1]?.text).toHaveLength(MAX_USER_TEXT_CHARS);
      stop();
    });

    it('builds https conversation URLs from validated ids only', () => {
      for (const [pathname, expected] of c.conversationCases) {
        expect(adapter.conversationUrl({ protocol: 'https:', hostname: c.host, pathname }), pathname).toBe(expected);
      }
      const [firstPath] = c.conversationCases[0] ?? ['/'];
      expect(adapter.conversationUrl({ protocol: 'http:', hostname: c.host, pathname: firstPath })).toBeUndefined();
      expect(adapter.conversationUrl({ protocol: 'https:', hostname: `${c.host}.evil.example`, pathname: firstPath })).toBeUndefined();
      expect(adapter.conversationUrl(new URL(`https://${c.host}${firstPath}`))).toBe(c.conversationCases[0]?.[1]);
    });

    it('detects the theme from site markers', () => {
      expect(adapter.theme(doc)).toBe(c.theme);
      c.flipTheme(doc);
      expect(adapter.theme(doc)).toBe(c.theme === 'dark' ? 'light' : 'dark');
      doc = loadFixture(c.fixtureDir, 'new-chat');
      expect(adapter.theme(doc)).toBe(c.newChatTheme);
    });

    it('anchors the chip 8px above the composer container at the text start', () => {
      const composer = adapter.findComposer(doc);
      if (!composer) throw new Error('composer missing');
      const container = composer.parentElement?.closest('form, fieldset, input-area-v2') ?? composer;
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 600, 700, 120));
      vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 620, 600, 40));
      composer.style.paddingLeft = '4px';
      const rect = adapter.anchorRect(composer);
      expect([rect.x, rect.y, rect.width, rect.height]).toEqual([124, 592, 676, 0]);
    });
  });
}
