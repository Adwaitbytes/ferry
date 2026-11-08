import type { Site } from '@ferry/core';
import {
  cleanUserText,
  fallbackTheme,
  insertTextAtStart,
  isHTMLElement,
  isTextControl,
  isEditableRoot,
  matchStrategies,
  plainText,
  readDraft,
} from './dom.js';
import { guard, reportAdapterError } from './errors.js';
import { observeDebounced } from './observe.js';
import type {
  AdapterHealth,
  AdapterProbe,
  LocationLike,
  SelectorStrategy,
  SentUserMessage,
  SiteAdapter,
  StrategyMatch,
  Theme,
} from './types.js';

/** Gap between the chip's bottom edge and the composer container (DESIGN.md 4.2). */
export const CHIP_GAP_PX = 8;
const MAX_DETAIL_CHARS = 200;
/** X-URL-1: conversation ids are rebuilt from a vendor template plus a validated id. */
const CONVERSATION_ID = /^[A-Za-z0-9-]{1,64}$/u;

export interface SiteSpec {
  site: Site;
  host: string;
  composer: readonly SelectorStrategy[];
  userTurns: readonly SelectorStrategy[];
  /** Assistant or tool output containers. A user-turn match inside one is rejected (X-ADP-1). */
  assistantContainers: string;
  /** Element inside a user turn holding only the typed text. The turn itself if absent. */
  userTextSelector?: string;
  /** Composer container used for chip placement, tried in order. The composer itself if none match. */
  anchorContainers: readonly string[];
  /** The conversation id from non-empty pathname segments, or undefined if not a conversation. */
  conversationId(segments: readonly string[]): string | undefined;
  conversationPrefix: string;
  /** Site-specific theme markers. Undefined defers to `color-scheme` and OS preference. */
  siteTheme(doc: Document): Theme | undefined;
}

interface UserTurn {
  key: string;
  text: string;
}

const truncateDetail = (detail: string): string => detail.slice(0, MAX_DETAIL_CHARS);

export function createAdapter(spec: SiteSpec): SiteAdapter {
  const isComposer = (el: Element): el is HTMLElement =>
    isHTMLElement(el) &&
    (isTextControl(el) || isEditableRoot(el)) &&
    el.closest(spec.assistantContainers) === null &&
    !spec.userTurns.some((s) => el.closest(s.selector) !== null);

  const isUserTurn = (el: Element): el is Element => el.closest(spec.assistantContainers) === null;

  const probe = (doc: Document): AdapterProbe => ({
    composer: matchStrategies(doc, spec.composer, isComposer),
    userTurns: matchStrategies(doc, spec.userTurns, isUserTurn),
  });

  const turnText = (turn: Element): string => {
    const inner = spec.userTextSelector ? turn.querySelector(spec.userTextSelector) : null;
    return cleanUserText(plainText(inner ?? turn));
  };

  const listUserTurns = (doc: Document): UserTurn[] => {
    const match: StrategyMatch | null = matchStrategies(doc, spec.userTurns, isUserTurn);
    return (match?.elements ?? []).map((el, index) => {
      const text = turnText(el);
      return { key: `${index}|${text}`, text };
    });
  };

  const findComposer = (doc: Document): HTMLElement | null =>
    guard('findComposer', null, () => probe(doc).composer?.elements[0] ?? null);

  const health = (doc: Document): AdapterHealth =>
    guard('health', { ok: false, detail: 'adapter degraded: health check failed' }, () => {
      const { composer, userTurns } = probe(doc);
      if (!composer) return { ok: false, detail: 'adapter degraded: composer not found' };
      if (composer.fallback) {
        return { ok: false, detail: truncateDetail(`adapter degraded: composer found by fallback (${composer.strategy})`) };
      }
      if (userTurns?.fallback) {
        return { ok: false, detail: truncateDetail(`adapter degraded: user turns found by fallback (${userTurns.strategy})`) };
      }
      const turns = userTurns ? `user turns via ${userTurns.strategy}` : 'no user turns on page';
      return { ok: true, detail: truncateDetail(`ok: composer via ${composer.strategy}; ${turns}`) };
    });

  /*
   * A turn counts as sent only when, after the DOM settles:
   * - exactly one user turn was appended (a jump of more than one is history rendering),
   * - the URL did not change, except the new-chat case where the first turn and the
   *   conversation URL appear together,
   * - the user typed in the composer since the last capture, which keeps sidebar
   *   navigation into an existing one-turn conversation from being captured.
   */
  const observeUserMessages = (doc: Document, onSent: (msg: SentUserMessage) => void): (() => void) =>
    guard('observeUserMessages', () => undefined, () => {
      const seen = new Set<string>();
      let count = 0;
      let url = doc.URL;
      let typed = false;

      const baseline = (turns: UserTurn[]): void => {
        for (const turn of turns) seen.add(turn.key);
        count = turns.length;
      };
      baseline(listUserTurns(doc));

      const onInput = (event: Event): void => {
        const target = event.target;
        const composer = findComposer(doc);
        if (composer && target instanceof Node && composer.contains(target)) typed = true;
      };
      doc.addEventListener('input', onInput, true);

      const flush = (): void => {
        const turns = listUserTurns(doc);
        const navigated = doc.URL !== url;
        const last = turns[turns.length - 1];
        const appendedOne = turns.length === count + 1 && (!navigated || count === 0);
        if (appendedOne && last && last.text === '') return;
        url = doc.URL;
        if (appendedOne && last && typed && !seen.has(last.key)) {
          typed = false;
          try {
            onSent({ text: last.text, at: new Date() });
          } catch (error) {
            reportAdapterError('observeUserMessages.onSent', error);
          }
        }
        baseline(turns);
      };

      const stopObserving = observeDebounced(doc.body ?? doc.documentElement, flush);
      return () => {
        stopObserving();
        doc.removeEventListener('input', onInput, true);
      };
    });

  const conversationUrl = (loc: LocationLike): string | undefined =>
    guard('conversationUrl', undefined, () => {
      if (loc.protocol !== 'https:' || loc.hostname !== spec.host) return undefined;
      const id = spec.conversationId(loc.pathname.split('/').filter((segment) => segment !== ''));
      if (id === undefined || !CONVERSATION_ID.test(id)) return undefined;
      return `https://${spec.host}${spec.conversationPrefix}${id}`;
    });

  const anchorRect = (composer: HTMLElement): DOMRect =>
    guard('anchorRect', new DOMRect(), () => {
      const container =
        spec.anchorContainers.map((selector) => composer.closest(selector)).find((el) => el !== null) ?? composer;
      const outer = container.getBoundingClientRect();
      const inner = composer.getBoundingClientRect();
      const view = composer.ownerDocument.defaultView;
      const padding = view ? Number.parseFloat(view.getComputedStyle(composer).paddingLeft) : 0;
      const x = inner.left + (Number.isFinite(padding) ? padding : 0);
      return new DOMRect(x, outer.top - CHIP_GAP_PX, Math.max(0, outer.right - x), 0);
    });

  return {
    site: spec.site,
    matches: (url) => guard('matches', false, () => url.protocol === 'https:' && url.hostname === spec.host),
    health,
    probe: (doc) => guard('probe', { composer: null, userTurns: null }, () => probe(doc)),
    findComposer,
    readDraft: (composer) => guard('readDraft', '', () => readDraft(composer)),
    insertAtStart: (composer, text) => guard('insertAtStart', false, () => insertTextAtStart(composer, text)),
    observeUserMessages,
    conversationUrl,
    theme: (doc) => guard<Theme>('theme', 'light', () => spec.siteTheme(doc) ?? fallbackTheme(doc)),
    anchorRect,
  };
}
