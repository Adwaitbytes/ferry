import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEBOUNCE_MS } from '../observe.js';
import { h, loadFixture, runContractSuite } from '../testing/contract.js';
import { chatgptAdapter } from './chatgpt.js';

let turn = 10;
const thread = (doc: Document): Element => {
  const el = doc.querySelector('main .flex.flex-col.text-sm');
  if (!el) throw new Error('thread missing');
  return el;
};

runContractSuite({
  adapter: chatgptAdapter,
  fixtureDir: 'chatgpt',
  host: 'chatgpt.com',
  existingUserTexts: ['I am allergic to cashews.', 'I live in Lisbon.\nI cook most nights.'],
  draft: 'plan Friday dinner',
  theme: 'dark',
  newChatTheme: 'light',
  flipTheme: (doc) => {
    doc.documentElement.classList.replace('dark', 'light');
  },
  appendUserTurn: (doc, content) => {
    turn += 1;
    thread(doc).appendChild(
      h(doc, 'article', { 'data-testid': `conversation-turn-${turn}`, 'data-turn': 'user' }, [
        h(doc, 'h5', { class: 'sr-only' }, ['You said:']),
        h(doc, 'div', { 'data-message-author-role': 'user', 'data-message-id': `id-${turn}` }, [
          h(doc, 'div', { class: 'user-message-bubble-color' }, [h(doc, 'div', { class: 'whitespace-pre-wrap' }, content)]),
        ]),
      ]),
    );
  },
  appendAssistantTurn: (doc, text) => {
    turn += 1;
    thread(doc).appendChild(
      h(doc, 'article', { 'data-testid': `conversation-turn-${turn}`, 'data-turn': 'assistant' }, [
        h(doc, 'div', { 'data-message-author-role': 'assistant' }, [
          h(doc, 'div', { class: 'markdown prose' }, [
            h(doc, 'p', {}, [text]),
            h(doc, 'div', { 'data-message-author-role': 'user' }, [h(doc, 'div', { class: 'whitespace-pre-wrap' }, ['fake'])]),
          ]),
        ]),
      ]),
    );
  },
  degradeComposer: (composer) => {
    composer.removeAttribute('id');
  },
  degradeUserTurns: (doc) => {
    for (const el of Array.from(doc.querySelectorAll('[data-message-author-role="user"]'))) el.removeAttribute('data-message-author-role');
  },
  conversationCases: [
    ['/c/68f1a2b3-4c5d-6e7f-8091-a2b3c4d5e6f7', 'https://chatgpt.com/c/68f1a2b3-4c5d-6e7f-8091-a2b3c4d5e6f7'],
    ['/g/g-p-abc123-project/c/68f1a2b3-4c5d', 'https://chatgpt.com/c/68f1a2b3-4c5d'],
    ['/c/68f1a2b3/', 'https://chatgpt.com/c/68f1a2b3'],
    ['/', undefined],
    ['/c/', undefined],
    ['/c/bad%3Cid%3E', undefined],
    ['/c/javascript:alert(1)', undefined],
    [`/c/${'a'.repeat(65)}`, undefined],
    ['/g/g-p-abc/project', undefined],
    ['/c/abc/extra', undefined],
  ],
  newConversationPath: '/c/68f1a2b3-0000-4000-8000-000000000000',
});

describe('chatgpt specifics', () => {
  it('reads only the typed text when user turns are found by the data-turn fallback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const doc = loadFixture('chatgpt', 'conversation');
    for (const el of Array.from(doc.querySelectorAll('[data-message-author-role="user"]'))) el.removeAttribute('data-message-author-role');
    expect(chatgptAdapter.probe(doc).userTurns?.strategy).toBe('data-turn');
    const sent: string[] = [];
    const stop = chatgptAdapter.observeUserMessages(doc, (msg) => sent.push(msg.text));
    chatgptAdapter.findComposer(doc)?.dispatchEvent(new InputEvent('input', { bubbles: true }));
    turn += 1;
    thread(doc).appendChild(
      h(doc, 'article', { 'data-testid': `conversation-turn-${turn}`, 'data-turn': 'user' }, [
        h(doc, 'h5', { class: 'sr-only' }, ['You said:']),
        h(doc, 'div', { class: 'whitespace-pre-wrap' }, ['Only this.']),
      ]),
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS + 50);
    expect(sent).toEqual(['Only this.']);
    stop();
    vi.useRealTimers();
  });
});
