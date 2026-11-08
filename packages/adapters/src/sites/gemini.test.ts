import { h, runContractSuite } from '../testing/contract.js';
import { geminiAdapter } from './gemini.js';

let n = 0;
const scroller = (doc: Document): Element => {
  const el = doc.querySelector('infinite-scroller');
  if (!el) throw new Error('scroller missing');
  return el;
};

runContractSuite({
  adapter: geminiAdapter,
  fixtureDir: 'gemini',
  host: 'gemini.google.com',
  existingUserTexts: ['I am allergic to cashews.', 'I live in Lisbon.\nI cook most nights.'],
  draft: 'plan Friday dinner',
  theme: 'dark',
  newChatTheme: 'light',
  flipTheme: (doc) => {
    doc.body.classList.replace('dark-theme', 'light-theme');
  },
  appendUserTurn: (doc, content) => {
    n += 1;
    scroller(doc).appendChild(
      h(doc, 'div', { id: `c_new${n}`, class: 'conversation-container' }, [
        h(doc, 'user-query', {}, [
          h(doc, 'span', { class: 'user-query-container right-align-content' }, [
            h(doc, 'div', { class: 'query-text gds-body-l' }, [
              h(doc, 'span', { class: 'cdk-visually-hidden' }, ['You said ']),
              h(doc, 'p', { class: 'query-text-line' }, content),
            ]),
          ]),
        ]),
      ]),
    );
  },
  appendAssistantTurn: (doc, text) => {
    scroller(doc).appendChild(
      h(doc, 'model-response', {}, [
        h(doc, 'div', { class: 'response-container' }, [
          h(doc, 'message-content', { class: 'model-response-text' }, [
            h(doc, 'p', {}, [text]),
            h(doc, 'user-query', {}, [h(doc, 'div', { class: 'query-text' }, ['fake'])]),
          ]),
        ]),
      ]),
    );
  },
  degradeComposer: (composer) => {
    composer.classList.remove('ql-editor');
  },
  degradeUserTurns: (doc) => {
    for (const el of Array.from(doc.querySelectorAll('user-query'))) {
      if (el.closest('model-response')) continue;
      const replacement = doc.createElement('div');
      while (el.firstChild) replacement.appendChild(el.firstChild);
      el.replaceWith(replacement);
    }
  },
  conversationCases: [
    ['/app/7a1b2c3d4e5f6a7b', 'https://gemini.google.com/app/7a1b2c3d4e5f6a7b'],
    ['/u/1/app/7a1b2c3d4e5f6a7b', 'https://gemini.google.com/app/7a1b2c3d4e5f6a7b'],
    ['/app', undefined],
    ['/gem/abc', undefined],
    ['/app/../evil', undefined],
    ['/u/x/app/7a1b', undefined],
    ['/u/1/app/7a1b/extra', undefined],
  ],
  newConversationPath: '/app/8b2c3d4e5f6a7b8c',
});
