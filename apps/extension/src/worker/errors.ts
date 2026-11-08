import type { WorkerError } from '@ferry/core';

export type WorkerErrorCode = WorkerError['code'];

/**
 * The only error type whose message may reach a caller. Anything else is mapped to a fixed
 * string, so upstream bodies, stack traces and key material can never be echoed (THREAT_MODEL 4).
 */
export class WorkerFailure extends Error {
  readonly code: WorkerErrorCode;
  readonly retryAfterMs: number | undefined;

  constructor(code: WorkerErrorCode, safeMessage: string, retryAfterMs?: number) {
    super(safeMessage);
    this.name = 'WorkerFailure';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export const MESSAGES = {
  invalid: 'Ferry could not read that request.',
  forbidden: 'This sender is not allowed to talk to Ferry.',
  locked: 'Ferry is locked. Open the side panel to continue.',
  noVault: 'Create a passphrase in the Ferry side panel first.',
  notPaired: 'Pair this browser with your Walrus Memory account first.',
  coolingDown: 'Cooling down to respect Walrus limits.',
  keyRejected: 'Walrus Memory rejected this browser key. Check Devices, then pair again.',
  upstream: 'Could not reach a Ferry service. Try again in a moment.',
  internal: 'Ferry hit an unexpected error. Try again.',
} as const;

export function toWorkerError(error: unknown): WorkerError {
  if (error instanceof WorkerFailure) {
    return error.retryAfterMs === undefined
      ? { ok: false, code: error.code, message: error.message }
      : { ok: false, code: error.code, message: error.message, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof Error && error.name === 'KeyRejectedError') {
    return { ok: false, code: 'key_rejected', message: MESSAGES.keyRejected };
  }
  if (error instanceof Error && error.name === 'ClockDriftError') {
    return {
      ok: false,
      code: 'upstream',
      message: 'This device clock is more than five minutes off. Fix the system time and retry.',
    };
  }
  if (error instanceof Error && error.name === 'CoolingDownError') {
    const resumeAt = (error as Error & { resumeAt?: unknown }).resumeAt;
    const wait =
      typeof resumeAt === 'number' ? Math.max(0, Math.round(resumeAt - Date.now())) : 10_000;
    return { ok: false, code: 'cooling_down', message: MESSAGES.coolingDown, retryAfterMs: wait };
  }
  if (isRateLimited(error)) {
    const retryAfterMs = retryAfterOf(error);
    return retryAfterMs === undefined
      ? { ok: false, code: 'cooling_down', message: MESSAGES.coolingDown }
      : { ok: false, code: 'cooling_down', message: MESSAGES.coolingDown, retryAfterMs };
  }
  return { ok: false, code: 'internal', message: MESSAGES.internal };
}

/** Recognizes MemWal 429s and relayer 503 AUTH_UPSTREAM_UNAVAILABLE without importing the SDK here. */
function isRateLimited(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; status?: unknown; serverCode?: unknown };
  return (
    e.name === 'MemWalRateLimitedError' ||
    e.name === 'RateLimitedError' ||
    e.status === 429 ||
    (e.status === 503 && e.serverCode === 'AUTH_UPSTREAM_UNAVAILABLE')
  );
}

function retryAfterOf(error: unknown): number | undefined {
  const e = error as { retryAfterMs?: unknown; retryAfter?: unknown };
  if (typeof e.retryAfterMs === 'number' && Number.isFinite(e.retryAfterMs))
    return Math.max(0, Math.round(e.retryAfterMs));
  if (typeof e.retryAfter === 'number' && Number.isFinite(e.retryAfter))
    return Math.max(0, Math.round(e.retryAfter * 1000));
  return undefined;
}
