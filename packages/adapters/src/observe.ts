import { reportAdapterError } from './errors.js';

export const DEFAULT_DEBOUNCE_MS = 250;

export interface DebouncedObserverOptions {
  delayMs?: number;
  init?: MutationObserverInit;
}

const DEFAULT_INIT: MutationObserverInit = { childList: true, subtree: true, characterData: true };

/**
 * Watches `target` and calls `onFlush` once the DOM has been quiet for `delayMs`. Vendor
 * pages mutate hundreds of times per streamed token, so callers only ever see settled DOM.
 * Errors from `onFlush` are reported, never rethrown into the page.
 */
export function observeDebounced(target: Node, onFlush: () => void, options: DebouncedObserverOptions = {}): () => void {
  if (typeof MutationObserver === 'undefined') {
    reportAdapterError('observeDebounced', new Error('MutationObserver unavailable'));
    return () => undefined;
  }
  const delayMs = options.delayMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const flush = (): void => {
    timer = undefined;
    if (stopped) return;
    try {
      onFlush();
    } catch (error) {
      reportAdapterError('observeDebounced.flush', error);
    }
  };

  const observer = new MutationObserver(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  observer.observe(target, options.init ?? DEFAULT_INIT);

  return () => {
    stopped = true;
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
