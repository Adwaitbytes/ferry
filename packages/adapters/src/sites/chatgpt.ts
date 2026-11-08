/*
 * ChatGPT adapter (chatgpt.com).
 *
 * Selector sources, read 2026-11-09:
 * - ChatGPT Performance Fix v2.1.16, SELECTORS.composer and userTurns
 *   https://greasyfork.org/scripts/526998-chatgpt-performance-fix/code
 *   (`#prompt-textarea.ProseMirror`, `div[contenteditable="true"][role="textbox"]#prompt-textarea`,
 *   `textarea[data-testid="prompt-textarea"]`, `[data-testid^="conversation-turn-"][data-turn="user"]`)
 * - ChatGPT Message Queue v1.0.0
 *   https://greasyfork.org/scripts/561517-chatgpt-message-queue/code
 *   (`div#prompt-textarea.ProseMirror[contenteditable="true"]`, execCommand insertText fallback)
 * - AI-Wattch platform detection, commit c2977ac (2026-10-29)
 *   https://github.com/AIWattch/AI-Wattch/blob/c2977ac84c5694cbc7fc69ca754677ba61708f4b/src/core/detection/platform.ts
 *   (`[data-message-author-role='user']`, `[data-message-author-role='assistant']`, `#prompt-textarea`)
 * - ArcRift PLATFORM_SELECTORS.md, commit 5424ea1 (2026-07-07)
 *   https://github.com/Eshaan-Nair/ArcRift/blob/5424ea14dd9a848dcbcfb49586f348324999af88/PLATFORM_SELECTORS.md
 *   (notes `data-message-author-role` stable across redesigns)
 * Theme: chatgpt.com toggles `dark` or `light` on <html>, with `color-scheme` as a backup.
 */
import { createAdapter } from '../adapter.js';
import { themeFromClasses } from '../dom.js';
import type { SiteAdapter } from '../types.js';

export const chatgptAdapter: SiteAdapter = createAdapter({
  site: 'chatgpt',
  host: 'chatgpt.com',
  composer: [
    { name: 'id-prosemirror', selector: '#prompt-textarea.ProseMirror[contenteditable="true"]' },
    { name: 'id-textbox', selector: 'div#prompt-textarea[contenteditable="true"]' },
    { name: 'data-testid-textarea', selector: 'textarea[data-testid="prompt-textarea"], textarea#prompt-textarea' },
    { name: 'form-prosemirror', selector: 'form .ProseMirror[contenteditable="true"]' },
    { name: 'form-textbox', selector: 'form [contenteditable="true"][role="textbox"]' },
  ],
  userTurns: [
    { name: 'author-role', selector: '[data-message-author-role="user"]' },
    { name: 'data-turn', selector: '[data-testid^="conversation-turn-"][data-turn="user"], article[data-turn="user"]' },
  ],
  assistantContainers:
    '[data-message-author-role="assistant"], [data-message-author-role="tool"], [data-message-author-role="system"], [data-turn="assistant"]',
  userTextSelector: '.whitespace-pre-wrap',
  anchorContainers: ['form'],
  conversationId: (segments) => {
    const [first, second, third, fourth, ...rest] = segments;
    if (rest.length > 0) return undefined;
    if (first === 'c' && third === undefined) return second;
    return first === 'g' && third === 'c' ? fourth : undefined;
  },
  conversationPrefix: '/c/',
  siteTheme: (doc) => themeFromClasses(doc.documentElement, 'dark', 'light'),
});
