import type { Site } from '@ferry/core';

export type Theme = 'light' | 'dark';

export interface AdapterHealth {
  ok: boolean;
  /** At most 200 chars, matches the `adapter.health` content message cap. */
  detail: string;
}

export interface SentUserMessage {
  text: string;
  at: Date;
}

/** The parts of `Location` an adapter reads. A real `Location` or a `URL` both satisfy it. */
export type LocationLike = Pick<Location, 'protocol' | 'hostname' | 'pathname'>;

/** One way of finding an element. Strategies are tried in order; index 0 is the primary. */
export interface SelectorStrategy {
  /** Short label used in health details, such as `data-testid` or `aria-textbox`. */
  name: string;
  selector: string;
}

export interface StrategyMatch<T extends Element = Element> {
  strategy: string;
  /** True when a strategy after the primary one matched. */
  fallback: boolean;
  elements: T[];
}

/** What feature detection found on the current page. */
export interface AdapterProbe {
  composer: StrategyMatch<HTMLElement> | null;
  userTurns: StrategyMatch | null;
}

export interface SiteAdapter {
  site: Site;
  matches(url: URL): boolean;
  health(doc: Document): AdapterHealth;
  probe(doc: Document): AdapterProbe;
  /** A textarea or a contenteditable root (ProseMirror on ChatGPT and Claude, Quill on Gemini). */
  findComposer(doc: Document): HTMLElement | null;
  readDraft(composer: HTMLElement): string;
  /** Places `text` before the existing draft through the editor's own input path. Never parses HTML. */
  insertAtStart(composer: HTMLElement, text: string): boolean;
  /**
   * Calls `onSent` once per new user-authored turn. Never for assistant turns or for
   * history already on the page. Returns a function that stops observing.
   */
  observeUserMessages(doc: Document, onSent: (msg: SentUserMessage) => void): () => void;
  /** Canonical https conversation URL, or undefined when the page is not a conversation. */
  conversationUrl(loc: LocationLike): string | undefined;
  theme(doc: Document): Theme;
  /**
   * Where the chip sits: `x` is the composer's text start, `y` is 8px above the top edge of
   * the composer container, `width` spans to the container's right edge, `height` is 0.
   */
  anchorRect(composer: HTMLElement): DOMRect;
}
