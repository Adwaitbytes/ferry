import type { DistillResponse } from '@ferry/core';
import { distill, StrictDistillRequest, toDistilledFact } from './distill.js';
import { DistillError, type LlmJson } from './llm.js';

/** X-DIS-1 body cap. Chunk count and size caps come from the core request schema. */
export const MAX_DISTILL_BODY_BYTES = 256 * 1024;

export type DistillErrorBody = { error: 'INVALID_REQUEST' | 'BODY_TOO_LARGE' | 'LLM_FAILED' };
export type DistillHttpResponse =
  | { status: 200; body: DistillResponse }
  | { status: 400 | 413 | 502; body: DistillErrorBody };

/** The only fields a server log line may carry (X-LOG-1). */
export interface SafeLogEvent {
  route: string;
  status: number;
  durationMs: number;
  requestId?: string;
  walletHash?: string;
  chunkCount?: number;
  code?: string;
}
export type SafeLog = (event: SafeLogEvent) => void;

const SAFE_STRING = /^[A-Za-z0-9_.:/-]{1,64}$/;
const STRING_FIELDS = ['route', 'requestId', 'walletHash', 'code'] as const;
const NUMBER_FIELDS = ['status', 'durationMs', 'chunkCount'] as const;

/**
 * Wraps a line sink so only allowlisted fields with identifier-shaped values are written. The
 * runtime check matters because callers can be untyped JavaScript or pass through foreign data.
 */
export function createSafeLogger(sink: (line: string) => void): SafeLog {
  return (event) => {
    const record = event as unknown as Record<string, unknown>;
    const out: Record<string, string | number> = {};
    for (const key of STRING_FIELDS) {
      const v = record[key];
      if (typeof v === 'string') out[key] = SAFE_STRING.test(v) ? v : '[redacted]';
    }
    for (const key of NUMBER_FIELDS) {
      const v = record[key];
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    }
    sink(JSON.stringify(out));
  };
}

export interface DistillHandlerDeps {
  llm: LlmJson;
  log: SafeLog;
  requestId?: string;
  now?: () => number;
}

/**
 * Framework-agnostic Distill route body. Takes the raw request text so the byte cap applies
 * before parsing. The request schema is strict: `system`, `model` or `temperature` fields are a
 * 400 and the LLM is never called. Responses and logs never contain chunk or provider text.
 */
export async function handleDistillRequest(rawBody: string, deps: DistillHandlerDeps): Promise<DistillHttpResponse> {
  const now = deps.now ?? Date.now;
  const started = now();
  const finish = (res: DistillHttpResponse, chunkCount?: number): DistillHttpResponse => {
    deps.log({
      route: 'distill',
      status: res.status,
      durationMs: now() - started,
      ...(deps.requestId === undefined ? {} : { requestId: deps.requestId }),
      ...(chunkCount === undefined ? {} : { chunkCount }),
      ...('error' in res.body ? { code: res.body.error } : {}),
    });
    return res;
  };

  if (new TextEncoder().encode(rawBody).byteLength > MAX_DISTILL_BODY_BYTES) {
    return finish({ status: 413, body: { error: 'BODY_TOO_LARGE' } });
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return finish({ status: 400, body: { error: 'INVALID_REQUEST' } });
  }
  const request = StrictDistillRequest.safeParse(json);
  if (!request.success) return finish({ status: 400, body: { error: 'INVALID_REQUEST' } });

  const chunkCount = request.data.chunks.length;
  try {
    const result = await distill(request.data.chunks, deps.llm);
    return finish({ status: 200, body: { facts: result.facts.map(toDistilledFact) } }, chunkCount);
  } catch (err) {
    const code = err instanceof DistillError && err.code === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'LLM_FAILED';
    return finish(code === 'INVALID_REQUEST' ? { status: 400, body: { error: code } } : { status: 502, body: { error: code } }, chunkCount);
  }
}
