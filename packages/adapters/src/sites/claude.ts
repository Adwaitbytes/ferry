/*
 * Claude adapter (claude.ai).
 *
 * Selector sources, read 2026-11-09:
 * - chatwait-extension Claude adapter, commit 97776b8 (2026-10-28)
 *   https://github.com/chatwait/chatwait-extension/blob/97776b856aca168e42a18999ab93a7db13d62125/entrypoints/content/adapters/claude.ts
 *   (composer `[data-testid="chat-input"]`, user turns `[data-testid="user-message"]`, bubbles
 *   `[data-cds="UserMessage"]` and `[data-user-message-bubble]`, streaming flag `data-is-streaming`)
 * - Claude Fold v1.7.0
 *   https://greasyfork.org/es/scripts/585939-claude-fold/code
 *   (`[data-testid="user-message"]`, assistant `.font-claude-response`; notes utility classes churn)
 * - ArcRift PLATFORM_SELECTORS.md, commit 5424ea1 (2026-07-07)
 *   https://github.com/Eshaan-Nair/ArcRift/blob/5424ea14dd9a848dcbcfb49586f348324999af88/PLATFORM_SELECTORS.md
 *   (`div.ProseMirror` composer fallback, `.font-user-message`, `[data-is-streaming]` on responses)
 * Theme: claude.ai sets `data-mode` on <html> (`dark` or `light`), and some builds add a `dark` class.
 */
import { createAdapter } from '../adapter.js';
import { themeFromClasses } from '../dom.js';
import type { SiteAdapter, Theme } from '../types.js';

function claudeTheme(doc: Document): Theme | undefined {
  const mode = doc.documentElement.getAttribute('data-mode');
  if (mode === 'dark' || mode === 'light') return mode;
  return themeFromClasses(doc.documentElement, 'dark', 'light');
}

export const claudeAdapter: SiteAdapter = createAdapter({
  site: 'claude',
  host: 'claude.ai',
  composer: [
    { name: 'data-testid', selector: '[data-testid="chat-input"][contenteditable="true"], textarea[data-testid="chat-input"]' },
    { name: 'aria-label', selector: '[contenteditable="true"][aria-label="Write your prompt to Claude"]' },
    { name: 'fieldset-prosemirror', selector: 'fieldset div.ProseMirror[contenteditable="true"]' },
    { name: 'prosemirror', selector: 'div.ProseMirror[contenteditable="true"]' },
  ],
  userTurns: [
    { name: 'data-testid', selector: '[data-testid="user-message"]' },
    { name: 'user-bubble', selector: '[data-cds="UserMessage"], [data-user-message-bubble]' },
    { name: 'font-class', selector: '.font-user-message' },
  ],
  assistantContainers: '.font-claude-response, [data-is-streaming]',
  anchorContainers: ['fieldset'],
  conversationId: ([first, second, ...rest]) => (first === 'chat' && rest.length === 0 ? second : undefined),
  conversationPrefix: '/chat/',
  siteTheme: claudeTheme,
});
