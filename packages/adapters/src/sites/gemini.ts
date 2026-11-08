/*
 * Gemini adapter (gemini.google.com).
 *
 * Selector sources, read 2026-11-09:
 * - AI-Wattch platform detection, commit c2977ac (2026-10-29)
 *   https://github.com/AIWattch/AI-Wattch/blob/c2977ac84c5694cbc7fc69ca754677ba61708f4b/src/core/detection/platform.ts
 *   (input `rich-textarea`, `div.ql-editor`, `div[contenteditable="true"]`; messages `user-query`,
 *   `model-response`, `message-content`)
 * - ArcRift PLATFORM_SELECTORS.md, commit 5424ea1 (2026-07-07)
 *   https://github.com/Eshaan-Nair/ArcRift/blob/5424ea14dd9a848dcbcfb49586f348324999af88/PLATFORM_SELECTORS.md
 *   (`.ql-editor`, `rich-textarea [contenteditable="true"]`, user `.query-text`, `user-query`,
 *   responses `model-response`, `.response-content`)
 * - Gemini Toolkit v2026.6.11.1
 *   https://greasyfork.org/cs/scripts/559371-gemini-toolkit/code
 *   (`.ql-editor[contenteditable="true"]`)
 * Theme: Gemini puts `dark-theme` or `light-theme` on <body>.
 */
import { createAdapter } from '../adapter.js';
import { themeFromClasses } from '../dom.js';
import type { SiteAdapter } from '../types.js';

export const geminiAdapter: SiteAdapter = createAdapter({
  site: 'gemini',
  host: 'gemini.google.com',
  composer: [
    { name: 'rich-textarea', selector: 'rich-textarea .ql-editor[contenteditable="true"]' },
    { name: 'ql-editor', selector: '.ql-editor[contenteditable="true"]' },
    { name: 'aria-prompt', selector: '[contenteditable="true"][role="textbox"][aria-label*="prompt" i]' },
    { name: 'input-area', selector: 'input-area-v2 [contenteditable="true"]:not(.ql-clipboard), .input-area [contenteditable="true"]:not(.ql-clipboard)' },
  ],
  userTurns: [
    { name: 'user-query', selector: 'user-query' },
    { name: 'user-query-class', selector: '.user-query-container, .user-query' },
  ],
  assistantContainers: 'model-response, .model-response-text, .response-container',
  userTextSelector: '.query-text',
  anchorContainers: ['input-area-v2', '.input-area', 'rich-textarea'],
  conversationId: (segments) => {
    const [first, second, third, fourth, ...rest] = segments;
    if (rest.length > 0) return undefined;
    if (first === 'app' && third === undefined) return second;
    return first === 'u' && /^\d{1,2}$/u.test(second ?? '') && third === 'app' ? fourth : undefined;
  },
  conversationPrefix: '/app/',
  siteTheme: (doc) => themeFromClasses(doc.body, 'dark-theme', 'light-theme'),
});
