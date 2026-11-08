/** Default slice budget. Keeps any one task far under the 50ms long-task line from PRD F2. */
export const DEFAULT_SLICE_BUDGET_MS = 8;

interface SchedulerLike {
  yield: () => Promise<void>;
}

function hasSchedulerYield(value: unknown): value is { scheduler: SchedulerLike } {
  if (typeof value !== 'object' || value === null || !('scheduler' in value)) return false;
  const scheduler: unknown = value.scheduler;
  return typeof scheduler === 'object' && scheduler !== null && 'yield' in scheduler && typeof scheduler.yield === 'function';
}

export function yieldToEventLoop(): Promise<void> {
  if (hasSchedulerYield(globalThis)) return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Returns a `tick` to call inside loops. It yields once the slice budget is spent and reports
 * whether the caller should stop because the signal was aborted.
 */
export function createTicker(budgetMs: number = DEFAULT_SLICE_BUDGET_MS, signal?: AbortSignal): () => Promise<boolean> {
  let sliceStart = performance.now();
  return async () => {
    if (performance.now() - sliceStart >= budgetMs) {
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
    return signal?.aborted === true;
  };
}
