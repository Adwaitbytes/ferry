import { systemClock, type Clock } from './clock.js';

/** gRPC status names (protobuf-ts reports them as strings) that mean "try again later". */
const RETRYABLE_GRPC = new Set(['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'DEADLINE_EXCEEDED']);

function hasStringCode(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}

function hasStatus(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number';
}

export function isRetryable(error: unknown): boolean {
  if (hasStatus(error) && (error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504)) {
    return true;
  }
  if (hasStringCode(error) && RETRYABLE_GRPC.has(error.code)) return true;
  // grpc-js maps an HTTP 429 from the gateway to UNAVAILABLE, but some proxies surface it only
  // in the message text.
  return error instanceof Error && /\b429\b|too many requests/i.test(error.message);
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  clock?: Clock;
  random?: () => number;
  onRetry?: (attempt: number, error: unknown) => void;
}

/** Exponential backoff with full jitter, so retries from parallel requests do not align. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const base = options.baseDelayMs ?? 250;
  const cap = options.maxDelayMs ?? 2000;
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      options.onRetry?.(attempt, error);
      await clock.sleep(Math.floor(random() * Math.min(cap, base * 2 ** (attempt - 1))));
    }
  }
}
