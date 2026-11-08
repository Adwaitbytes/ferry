import { ImportProgress, MemoryRef, StoredMemory, Suggestion, WorkerError, type WebAppRequest } from '@ferry/core';
import { z } from 'zod';
import { publicEnv } from './env';

/*
 * The web app reaches memory only through the Ferry extension (RESEARCH 1.7: the relayer sends no
 * CORS header, and no Ferry server may see memory traffic). Requests are core `WebAppRequest`s sent
 * with `chrome.runtime.sendMessage(extensionId, ...)`; every response is zod-validated here and
 * never trusted partially.
 */

/* ---------------------------------------------------------------- */
/* Response shapes. Mirrors apps/extension/src/worker/ports.ts.       */
/* ---------------------------------------------------------------- */

const Hex64 = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/);

export const ExtensionStatus = z.looseObject({
  version: z.string().max(40).optional(),
  /** A passphrase vault exists in this browser. */
  hasVault: z.boolean().optional(),
  locked: z.boolean(),
  paired: z.boolean(),
  accountId: z.string().regex(/^0x[0-9a-f]{64}$/).nullable().optional(),
  publicKey: Hex64.nullable().optional(),
});
export type ExtensionStatus = z.infer<typeof ExtensionStatus>;

export const PairingOffer = z.looseObject({
  publicKey: Hex64,
  fingerprint: z.string().max(40),
});
export type PairingOffer = z.infer<typeof PairingOffer>;

export const LibraryItem = z.looseObject({
  memory: StoredMemory,
  endEpoch: z.number().int().nullable(),
  blobId: z.string().max(128),
  /** Present on items whose status is `conflict`: the record to resolve and the other side. */
  conflict: z
    .object({ conflictId: z.uuid(), other: StoredMemory })
    .optional(),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const LibraryPage = z.looseObject({
  items: z.array(LibraryItem),
  nextCursor: z.string().max(200).nullable(),
});
export type LibraryPage = z.infer<typeof LibraryPage>;

/** The worker returns a bare array today; a wrapped `{ items }` is accepted too. */
const RecallResult = z.union([z.array(Suggestion), z.looseObject({ items: z.array(Suggestion) }).transform((r) => r.items)]);

const WriteOutcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('written'), ref: MemoryRef }),
  z.object({ kind: z.literal('pending') }),
  z.object({ kind: z.literal('conflict'), conflictId: z.string(), verdict: z.enum(['contradicts', 'refines']) }),
  z.object({ kind: z.literal('merged'), ref: MemoryRef }),
  z.object({ kind: z.literal('quarantined') }),
  z.object({ kind: z.literal('blocked'), categories: z.array(z.string()) }),
  z.object({ kind: z.literal('failed') }),
]);
export type WriteOutcome = z.infer<typeof WriteOutcome>;

const Void = z.unknown().transform(() => undefined);

const responseSchemas = {
  'status.get': ExtensionStatus,
  'pairing.begin': PairingOffer,
  'pairing.confirm': Void,
  'import.enqueue': z.looseObject({ queued: z.number().int().nonnegative() }),
  'import.progress': ImportProgress,
  'memory.list': LibraryPage,
  'memory.recall': RecallResult,
  'memory.save': WriteOutcome,
  'memory.hide': Void,
  'memory.resolve': Void,
  'data.export': z.union([z.array(StoredMemory), z.looseObject({ memories: z.array(StoredMemory) }).transform((r) => r.memories)]),
} as const satisfies Record<WebAppRequest['type'], z.ZodType>;

type ResponseSchemas = typeof responseSchemas;
export type BridgeResponse<T extends WebAppRequest['type']> = z.output<ResponseSchemas[T]>;

/* ---------------------------------------------------------------- */
/* Errors                                                            */
/* ---------------------------------------------------------------- */

export type BridgeErrorKind =
  | 'not_installed'
  | 'locked'
  | 'not_paired'
  | 'cooling_down'
  | 'timeout'
  | 'invalid_response'
  | 'forbidden'
  | 'upstream'
  | 'internal';

const MESSAGES: Record<BridgeErrorKind, string> = {
  not_installed: 'Ferry is not installed in this browser, or it does not trust this site yet.',
  locked: 'Ferry is locked. Open the Ferry side panel and enter your passphrase.',
  not_paired: 'Pair this browser with your Walrus Memory account first.',
  cooling_down: 'Walrus Memory is cooling down after many requests.',
  timeout: 'Ferry did not answer in time. Check that the extension is enabled, then try again.',
  invalid_response: 'Ferry answered in a shape this page does not understand. Update the extension and reload.',
  forbidden: 'Ferry refused this request from the web app.',
  upstream: 'Could not reach a Ferry service. Try again in a moment.',
  internal: 'Ferry hit an unexpected error. Try again.',
};

export class BridgeError extends Error {
  readonly kind: BridgeErrorKind;
  readonly retryAfterMs: number | undefined;

  constructor(kind: BridgeErrorKind, message?: string, retryAfterMs?: number) {
    super(message ?? MESSAGES[kind]);
    this.name = 'BridgeError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isBridgeError(error: unknown, kind?: BridgeErrorKind): error is BridgeError {
  return error instanceof BridgeError && (kind === undefined || error.kind === kind);
}

function fromWorkerError(error: WorkerError): BridgeError {
  switch (error.code) {
    case 'locked':
      return new BridgeError('locked', error.message);
    case 'not_paired':
      return new BridgeError('not_paired', error.message);
    case 'cooling_down':
      return new BridgeError('cooling_down', error.message, error.retryAfterMs);
    case 'forbidden_sender':
      return new BridgeError('forbidden', error.message);
    case 'upstream':
      return new BridgeError('upstream', error.message);
    default:
      return new BridgeError('internal', error.message);
  }
}

/* ---------------------------------------------------------------- */
/* Transport                                                         */
/* ---------------------------------------------------------------- */

interface ChromeRuntimeLike {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string } | undefined;
}

function runtime(): ChromeRuntimeLike | null {
  const chromeGlobal: unknown = Reflect.get(globalThis, 'chrome');
  if (typeof chromeGlobal !== 'object' || chromeGlobal === null) return null;
  const rt: unknown = Reflect.get(chromeGlobal, 'runtime');
  if (typeof rt !== 'object' || rt === null || typeof Reflect.get(rt, 'sendMessage') !== 'function') return null;
  return rt as ChromeRuntimeLike;
}

const SuccessEnvelope = z.object({ ok: z.literal(true), data: z.unknown() });
const DEFAULT_TIMEOUT_MS = 15_000;

function sendRaw(message: WebAppRequest, timeoutMs: number): Promise<unknown> {
  const extensionId = publicEnv.extensionId;
  const rt = runtime();
  if (!extensionId || !rt) return Promise.reject(new BridgeError('not_installed'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new BridgeError('timeout'));
    }, timeoutMs);
    try {
      rt.sendMessage(extensionId, message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Reading lastError marks it handled; it is set when no extension with this id listens.
        if (rt.lastError) reject(new BridgeError('not_installed'));
        else resolve(response);
      });
    } catch {
      settled = true;
      clearTimeout(timer);
      reject(new BridgeError('not_installed'));
    }
  });
}

/** Sends one request to the extension and returns its validated data, or throws a BridgeError. */
export async function bridge<T extends WebAppRequest['type']>(
  message: Extract<WebAppRequest, { type: T }>,
  opts: { timeoutMs?: number } = {},
): Promise<BridgeResponse<T>> {
  const raw = await sendRaw(message, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const failure = WorkerError.safeParse(raw);
  if (failure.success) throw fromWorkerError(failure.data);
  const envelope = SuccessEnvelope.safeParse(raw);
  if (!envelope.success) throw new BridgeError('invalid_response');
  // TypeScript cannot correlate `message.type` with the indexed schema, so the link is asserted once here.
  const schema = responseSchemas[message.type] as unknown as z.ZodType<BridgeResponse<T>>;
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) throw new BridgeError('invalid_response');
  return data.data;
}

export function bridgeConfigured(): boolean {
  return publicEnv.extensionId !== null;
}
