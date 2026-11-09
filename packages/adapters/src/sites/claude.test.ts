import { describe, expect, it, vi } from 'vitest';
import { h, loadFixture, runContractSuite } from '../testing/contract.js';
import { claudeAdapter } from './claude.js';

const thread = (doc: Document): Element => {
  const el = doc.querySelector('main .flex-1.flex.flex-col.gap-3');
  if (!el) throw new Error('thread missing');
  return el;
};

runContractSuite({
  adapter: claudeAdapter,
  fixtureDir: 'claude',
  host: 'claude.ai',
  existingUserTexts: ['I am allergic to cashews.', 'I live in Lisbon.\nI cook most nights.'],
  draft: 'plan Friday dinner',
  theme: 'dark',
  newChatTheme: 'light',
  flipTheme: (doc) => {
    doc.documentElement.setAttribute('data-mode', 'light');
  },
  appendUserTurn: (doc, content) => {
    thread(doc).appendChild(
      h(doc, 'div', { 'data-test-render-count': '1' }, [
        h(doc, 'div', { class: 'mb-1 mt-1' }, [
          h(doc, 'div', { class: 'group relative inline-flex', 'data-cds': 'UserMessage' }, [
            h(doc, 'div', { 'data-testid': 'user-message', class: 'font-large !font-user-message grid' }, [
              h(doc, 'p', { class: 'whitespace-pre-wrap break-words' }, content),
            ]),
          ]),
        ]),
      ]),
    );
  },
  appendAssistantTurn: (doc, text) => {
    thread(doc).appendChild(
      h(doc, 'div', { 'data-test-render-count': '1' }, [
        h(doc, 'div', { 'data-is-streaming': 'false', class: 'group relative pb-3' }, [
          h(doc, 'div', { class: 'font-claude-response relative' }, [
            h(doc, 'p', {}, [text]),
            h(doc, 'div', { 'data-testid': 'user-message' }, [h(doc, 'p', {}, ['fake'])]),
          ]),
        ]),
      ]),
    );
  },
  degradeComposer: (composer) => {
    composer.removeAttribute('data-testid');
  },
  degradeUserTurns: (doc) => {
    for (const el of Array.from(doc.querySelectorAll('[data-testid="user-message"]'))) {
      if (el.closest('.font-claude-response')) continue;
      el.removeAttribute('data-testid');
      el.closest('.group')?.setAttribute('data-cds', 'UserMessage');
    }
  },
  conversationCases: [
    ['/chat/5e0c1f9a-2b3d-4c5e-8f70-9a1b2c3d4e5f', 'https://claude.ai/chat/5e0c1f9a-2b3d-4c5e-8f70-9a1b2c3d4e5f'],
    ['/chat/5e0c1f9a/', 'https://claude.ai/chat/5e0c1f9a'],
    ['/new', undefined],
    ['/project/abc', undefined],
    ['/chat/a.b', undefined],
  ],
  newConversationPath: '/chat/5e0c1f9a-0000-4000-8000-000000000000',
});

describe('claude: live thread that keeps only the newest exchange mounted', () => {
  it('fires once when the single mounted user turn is replaced by the message just typed', async () => {
    vi.useFakeTimers();
    const doc = loadFixture('claude', 'conversation');
    const sent: string[] = [];
    const stop = claudeAdapter.observeUserMessages(doc, (m) => sent.push(m.text));
    const composer = claudeAdapter.findComposer(doc);
    if (!composer) throw new Error('composer missing');
    composer.textContent = 'I moved to Pune last month.';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    // Claude unmounts older turns: the thread now holds only the new exchange.
    const t = thread(doc);
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(
      h(doc, 'div', {}, [
        h(doc, 'div', { 'data-cds': 'UserMessage' }, [
          h(doc, 'div', { 'data-testid': 'user-message' }, [h(doc, 'p', {}, ['I moved to Pune last month.'])]),
        ]),
      ]),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual(['I moved to Pune last month.']);
    // A re-render of the same turn does not fire again.
    t.appendChild(h(doc, 'div', {}, []));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    stop();
    vi.useRealTimers();
  });
});
