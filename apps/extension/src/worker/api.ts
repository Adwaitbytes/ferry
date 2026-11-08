import {
  AccountView,
  BlobView,
  DistillRequest,
  DistillResponse,
  MAX_CHUNK_CHARS,
  JudgeRequest,
  JudgeResponse,
  SuiObjectId,
} from '@ferry/core';
import type { z } from 'zod';
import { API_ROUTES } from '../lib/config';
import { MESSAGES, WorkerFailure } from './errors';
import type { FerryApi } from './ports';

const TIMEOUT_MS = 12_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * HTTP client for the Ferry server. Every response is parsed with the core schema; a body that does
 * not match is treated as an upstream failure, never trusted partially. Upstream text is never
 * surfaced to callers.
 */
export function createFerryApi(
  origin: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): FerryApi {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new WorkerFailure('upstream', MESSAGES.upstream);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new WorkerFailure(
        'cooling_down',
        MESSAGES.coolingDown,
        Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10_000,
      );
    }
    if (!response.ok) throw new WorkerFailure('upstream', MESSAGES.upstream);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WorkerFailure('upstream', MESSAGES.upstream);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new WorkerFailure('upstream', MESSAGES.upstream);
    return parsed.data;
  }

  return {
    getAccount: async (accountId) => {
      if (!SuiObjectId.safeParse(accountId).success)
        throw new WorkerFailure('invalid_message', MESSAGES.invalid);
      return call(API_ROUTES.account(accountId), AccountView);
    },
    getBlob: (blobId) => call(API_ROUTES.blob(blobId), BlobView),
    distillMessage: async ({ site, userText, conversationIdHash, messageAt }) => {
      const request = DistillRequest.parse({
        chunks: [
          {
            chunkId: 'live-0',
            vendor: site,
            conversationIdHash,
            messageAt,
            userText: userText.slice(0, MAX_CHUNK_CHARS),
          },
        ],
      });
      return (
        await call(API_ROUTES.distill, DistillResponse, {
          method: 'POST',
          body: JSON.stringify(request),
        })
      ).facts;
    },
    judge: async (request) =>
      call(API_ROUTES.judge, JudgeResponse, {
        method: 'POST',
        body: JSON.stringify(JudgeRequest.parse(request)),
      }),
  };
}
