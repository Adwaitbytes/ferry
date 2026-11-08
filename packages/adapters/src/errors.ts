export type AdapterErrorReporter = (context: string, error: unknown) => void;

const defaultReporter: AdapterErrorReporter = (context, error) => {
  console.warn(`ferry adapter: ${context}`, error);
};

let reporter: AdapterErrorReporter = defaultReporter;

/**
 * Adapters run inside vendor pages and must never throw into them, so every entry point
 * catches and routes the error here. The content script swaps in a reporter that forwards
 * to the worker as an `adapter.health` message.
 */
export function setAdapterErrorReporter(next: AdapterErrorReporter | null): void {
  reporter = next ?? defaultReporter;
}

export function reportAdapterError(context: string, error: unknown): void {
  try {
    reporter(context, error);
  } catch {
    // A faulty reporter must not turn a contained adapter error into a page error.
  }
}

/** Runs `fn`, reporting and returning `fallback` if it throws. */
export function guard<T>(context: string, fallback: T, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    reportAdapterError(context, error);
    return fallback;
  }
}
