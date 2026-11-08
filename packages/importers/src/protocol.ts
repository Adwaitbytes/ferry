import { DistillRequest, Vendor } from '@ferry/core';
import { z } from 'zod';
import { importFiles, importPaste, importZip } from './import.js';
import { MAX_PASTE_CHARS } from './paste.js';
import type { ChunkSource, ImportError, ImportProgressEvent, ImportResult, Result } from './types.js';
import { err } from './types.js';

/**
 * Message protocol between the page and the import Web Worker. Both directions are zod-validated:
 * the worker trusts nothing it receives, and the page trusts nothing the worker sends back.
 */

const JobId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const IsoWithOffset = z.iso.datetime({ offset: true });
const ImportVendorSchema = Vendor.extract(['chatgpt', 'claude', 'gemini', 'paste']);

export const ImportWorkerRequest = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('import.zip'),
    jobId: JobId,
    bytes: z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]),
    now: IsoWithOffset.optional(),
  }),
  z.object({
    type: z.literal('import.files'),
    jobId: JobId,
    files: z.array(z.object({ name: z.string().min(1).max(512), text: z.string() })).min(1).max(8),
    now: IsoWithOffset.optional(),
  }),
  z.object({ type: z.literal('import.paste'), jobId: JobId, text: z.string().max(MAX_PASTE_CHARS), now: IsoWithOffset.optional() }),
  z.object({ type: z.literal('import.cancel'), jobId: JobId }),
]);
export type ImportWorkerRequest = z.infer<typeof ImportWorkerRequest>;

const Count = z.number().int().nonnegative();

export const ImportProgressSchema = z.object({
  stage: z.enum(['reading', 'inflating', 'parsing', 'chunking', 'done']),
  filesParsed: Count,
  conversations: Count,
  chunks: Count,
  bytesInflated: Count,
});

const Name = z.string().max(200);
export const ImportErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('archive_too_large'), limit: Count, actual: Count }),
  z.object({ kind: z.literal('not_a_zip') }),
  z.object({ kind: z.literal('corrupt_zip'), detail: z.string().max(300) }),
  z.object({ kind: z.literal('too_many_entries'), limit: Count }),
  z.object({ kind: z.literal('unsafe_entry_name'), name: Name }),
  z.object({ kind: z.literal('unsupported_entry'), name: z.string(), reason: z.enum(['encrypted', 'compression_method']) }),
  z.object({ kind: z.literal('entry_too_large'), name: z.string(), limit: Count }),
  z.object({ kind: z.literal('total_too_large'), limit: Count }),
  z.object({ kind: z.literal('zip_bomb'), name: z.string(), ratio: z.number() }),
  z.object({ kind: z.literal('unrecognized_export') }),
  z.object({ kind: z.literal('malformed_json'), file: z.string() }),
  z.object({ kind: z.literal('invalid_shape'), file: z.string(), detail: z.string().max(300) }),
  z.object({ kind: z.literal('paste_too_large'), limit: Count, actual: Count }),
  z.object({ kind: z.literal('empty_input') }),
  z.object({ kind: z.literal('aborted') }),
  z.object({ kind: z.literal('worker_failed'), detail: z.string().max(300) }),
]) satisfies z.ZodType<ImportError>;

const ChunkSourceSchema = z.object({
  chunkId: z.string().min(1).max(64),
  vendor: ImportVendorSchema,
  conversationId: z.string().min(1).max(200),
  conversationTitle: z.string().nullable(),
  conversationUrl: z.url({ protocol: /^https$/ }).nullable(),
  messageAt: IsoWithOffset,
  rawUserText: z.string(),
  segments: z.array(z.object({ start: Count, end: Count, messageAt: IsoWithOffset })),
}) satisfies z.ZodType<ChunkSource>;

export const ImportResultSchema = z.object({
  vendor: ImportVendorSchema,
  chunks: z.array(DistillRequest.shape.chunks.element),
  sources: z.array(ChunkSourceSchema),
  stats: z.object({ files: Count, conversations: Count, userTurns: Count, chunks: Count, skippedConversations: Count }),
}) satisfies z.ZodType<ImportResult>;

const eventVariants = <R extends z.ZodType>(result: R) =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('import.progress'), jobId: JobId, progress: ImportProgressSchema }),
    z.object({ type: z.literal('import.done'), jobId: JobId, result }),
    z.object({ type: z.literal('import.failed'), jobId: JobId, error: ImportErrorSchema }),
    z.object({ type: z.literal('import.rejected'), detail: z.string().max(300) }),
  ]);

/** Full contract. The worker checks its own output against it before posting. */
export const ImportWorkerEvent = eventVariants(ImportResultSchema);
export type ImportWorkerEvent = z.infer<typeof ImportWorkerEvent>;

/**
 * What the page checks. Deep-validating thousands of chunks here would be a long main-thread task;
 * the worker already validated them, and each Distill batch is validated again when it is built.
 */
const PageWorkerEvent = eventVariants(
  z.custom<ImportResult>((value) => ImportResultSchema.pick({ vendor: true, stats: true }).safeParse(value).success),
);

/** Progress is coalesced so a 50 MB inflate does not flood the page with thousands of messages. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * Builds the worker-side message handler. Kept separate from the worker global so it can run and
 * be tested anywhere; `worker.ts` wires it to `self`.
 */
export function createImportWorkerHandler(post: (event: ImportWorkerEvent) => void): (data: unknown) => Promise<void> {
  const jobs = new Map<string, AbortController>();
  return async (data) => {
    const parsed = ImportWorkerRequest.safeParse(data);
    if (!parsed.success) {
      post({ type: 'import.rejected', detail: 'invalid import request' });
      return;
    }
    const request = parsed.data;
    if (request.type === 'import.cancel') {
      jobs.get(request.jobId)?.abort();
      return;
    }
    const controller = new AbortController();
    jobs.set(request.jobId, controller);
    let lastPost = 0;
    let lastStage = '';
    const onProgress = (progress: ImportProgressEvent): void => {
      const now = performance.now();
      if (progress.stage === lastStage && now - lastPost < PROGRESS_INTERVAL_MS) return;
      lastPost = now;
      lastStage = progress.stage;
      post({ type: 'import.progress', jobId: request.jobId, progress });
    };
    const opts = { signal: controller.signal, onProgress, ...(request.now ? { now: new Date(request.now) } : {}) };
    try {
      let result: Result<ImportResult>;
      if (request.type === 'import.zip') {
        const bytes = request.bytes instanceof Uint8Array ? request.bytes : new Uint8Array(request.bytes);
        result = await importZip(bytes, opts);
      } else if (request.type === 'import.files') {
        result = await importFiles(request.files, opts);
      } else {
        result = await importPaste(request.text, opts);
      }
      const event: ImportWorkerEvent = result.ok
        ? { type: 'import.done', jobId: request.jobId, result: result.value }
        : { type: 'import.failed', jobId: request.jobId, error: result.error };
      const checked = ImportWorkerEvent.safeParse(event);
      post(
        checked.success
          ? checked.data
          : { type: 'import.failed', jobId: request.jobId, error: { kind: 'worker_failed', detail: 'importer output failed validation' } },
      );
    } catch {
      // Last line of defense: an unexpected bug still ends the job with a typed error, never a hang.
      post({ type: 'import.failed', jobId: request.jobId, error: { kind: 'worker_failed', detail: 'unexpected importer failure' } });
    } finally {
      jobs.delete(request.jobId);
    }
  };
}

export interface WorkerScopeLike {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

export function attachImportWorker(scope: WorkerScopeLike): void {
  const handle = createImportWorkerHandler((event) => scope.postMessage(event));
  scope.addEventListener('message', (event) => {
    void handle(event.data);
  });
}

export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message' | 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'message' | 'error', listener: (event: Event) => void): void;
}

export type ImportJob =
  | { type: 'import.zip'; bytes: Uint8Array; now?: string }
  | { type: 'import.files'; files: { name: string; text: string }[]; now?: string }
  | { type: 'import.paste'; text: string; now?: string };

/**
 * Page-side helper: runs one job in the worker and resolves with a typed result. Bytes are
 * transferred, not copied, so a large export does not double in memory on the main thread.
 */
export function runImportInWorker(
  worker: WorkerLike,
  job: ImportJob,
  opts: { onProgress?: (progress: ImportProgressEvent) => void; signal?: AbortSignal } = {},
): Promise<Result<ImportResult>> {
  const jobId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (result: Result<ImportResult>): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onMessage = (event: Event): void => {
      const parsed = PageWorkerEvent.safeParse((event as MessageEvent).data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'import.rejected' || message.jobId !== jobId) return;
      if (message.type === 'import.progress') opts.onProgress?.(message.progress);
      else if (message.type === 'import.done') finish({ ok: true, value: message.result });
      else finish(err(message.error));
    };
    const onError = (): void => finish(err({ kind: 'worker_failed', detail: 'import worker crashed' }));
    const onAbort = (): void => worker.postMessage({ type: 'import.cancel', jobId }, []);
    const request = { ...job, jobId };
    if (!ImportWorkerRequest.safeParse(request).success) {
      resolve(err({ kind: 'worker_failed', detail: 'invalid import request' }));
      return;
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const transfer: Transferable[] = job.type === 'import.zip' ? [job.bytes.buffer as ArrayBuffer] : [];
    worker.postMessage(request, transfer);
  });
}
