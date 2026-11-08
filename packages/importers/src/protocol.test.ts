import { describe, expect, it, vi } from 'vitest';
import {
  ImportWorkerEvent,
  attachImportWorker,
  createImportWorkerHandler,
  runImportInWorker,
  type WorkerLike,
  type WorkerScopeLike,
} from './protocol.js';
import { fixture, zipOf } from './test-helpers.js';
import { isWorkerScope } from './worker.js';

/** In-memory stand-in for a dedicated worker: the page side and the worker side share one channel. */
function fakeWorker(): WorkerLike & { crash: () => void; posted: unknown[] } {
  const listeners = { message: new Set<(e: Event) => void>(), error: new Set<(e: Event) => void>() };
  const posted: unknown[] = [];
  const toPage = (data: unknown) => {
    for (const l of listeners.message) l(new MessageEvent('message', { data }));
  };
  const handle = createImportWorkerHandler(toPage);
  return {
    posted,
    postMessage: (message) => {
      posted.push(message);
      void handle(message);
    },
    addEventListener: (type, listener) => listeners[type].add(listener),
    removeEventListener: (type, listener) => listeners[type].delete(listener),
    crash: () => {
      for (const l of listeners.error) l(new Event('error'));
    },
  };
}

describe('createImportWorkerHandler', () => {
  it('rejects messages that fail validation', async () => {
    const post = vi.fn();
    const handle = createImportWorkerHandler(post);
    await handle({ type: 'import.zip', jobId: '../x', bytes: 'nope' });
    await handle(null);
    expect(post).toHaveBeenCalledWith({ type: 'import.rejected', detail: 'invalid import request' });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('runs a zip job and posts throttled progress then a validated result', async () => {
    const events: ImportWorkerEvent[] = [];
    const handle = createImportWorkerHandler((e) => events.push(e));
    const bytes = zipOf({ 'conversations.json': fixture('chatgpt/conversations.json'), 'user.json': '{}' });
    await handle({ type: 'import.zip', jobId: 'job-1', bytes: bytes.buffer, now: '2026-11-09T00:00:00Z' });
    const done = events.at(-1);
    expect(done?.type).toBe('import.done');
    expect(events.filter((e) => e.type === 'import.progress').length).toBeGreaterThan(0);
    expect(events.every((e) => ImportWorkerEvent.safeParse(e).success)).toBe(true);
  });

  it('posts typed failures', async () => {
    const events: ImportWorkerEvent[] = [];
    const handle = createImportWorkerHandler((e) => events.push(e));
    await handle({ type: 'import.zip', jobId: 'j', bytes: new Uint8Array(3) });
    expect(events.at(-1)).toEqual({ type: 'import.failed', jobId: 'j', error: { kind: 'not_a_zip' } });
  });

  it('cancels a running job', async () => {
    const events: ImportWorkerEvent[] = [];
    const handle = createImportWorkerHandler((e) => events.push(e));
    const running = handle({ type: 'import.files', jobId: 'c', files: [{ name: 'conversations.json', text: fixture('claude/conversations.json') }] });
    await handle({ type: 'import.cancel', jobId: 'c' });
    await handle({ type: 'import.cancel', jobId: 'unknown' });
    await running;
    expect(events.at(-1)).toEqual({ type: 'import.failed', jobId: 'c', error: { kind: 'aborted' } });
  });

  it('turns an unexpected exception into worker_failed', async () => {
    const events: ImportWorkerEvent[] = [];
    let first = true;
    const handle = createImportWorkerHandler((e) => {
      if (first && e.type === 'import.progress') {
        first = false;
        throw new Error('listener blew up');
      }
      events.push(e);
    });
    await handle({ type: 'import.paste', jobId: 'p', text: 'I like synthetic tea.' });
    expect(events.at(-1)).toMatchObject({ type: 'import.failed', error: { kind: 'worker_failed' } });
  });

  it('keeps conversation ids up to the receipt cap', async () => {
    const events: ImportWorkerEvent[] = [];
    const handle = createImportWorkerHandler((e) => events.push(e));
    const conversations = JSON.stringify([{ uuid: 'x'.repeat(200), chat_messages: [{ sender: 'human', text: 'hello there' }] }]);
    await handle({ type: 'import.files', jobId: 'v', files: [{ name: 'conversations.json', text: conversations }], now: '2026-11-09T00:00:00+02:00' });
    const done = events.at(-1);
    expect(done?.type === 'import.done' && done.result.sources[0]?.conversationUrl).toBeNull();
  });
});

describe('attachImportWorker', () => {
  it('wires the handler to a worker scope', async () => {
    let listener: ((e: MessageEvent) => void) | undefined;
    const posted: unknown[] = [];
    const scope: WorkerScopeLike = {
      addEventListener: (_type, l) => {
        listener = l;
      },
      postMessage: (m) => posted.push(m),
    };
    attachImportWorker(scope);
    listener?.(new MessageEvent('message', { data: { type: 'bogus' } }));
    await vi.waitFor(() => expect(posted).toEqual([{ type: 'import.rejected', detail: 'invalid import request' }]));
  });

  it('only auto-attaches inside a real worker scope', () => {
    expect(isWorkerScope(globalThis)).toBe(false);
    class WorkerGlobalScope {
      readonly kind = 'worker';
    }
    Reflect.set(globalThis, 'WorkerGlobalScope', WorkerGlobalScope);
    try {
      expect(isWorkerScope(new WorkerGlobalScope())).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis, 'WorkerGlobalScope');
    }
  });
});

describe('runImportInWorker', () => {
  it('resolves with the result and reports progress', async () => {
    const worker = fakeWorker();
    const progress = vi.fn();
    const bytes = zipOf({ 'Takeout/My Activity/Gemini Apps/MyActivity.json': fixture('gemini/MyActivity.json') });
    const result = await runImportInWorker(worker, { type: 'import.zip', bytes }, { onProgress: progress });
    expect(result.ok && result.value.vendor).toBe('gemini');
    expect(progress).toHaveBeenCalled();
  });

  it('resolves with typed errors', async () => {
    const worker = fakeWorker();
    const result = await runImportInWorker(worker, { type: 'import.paste', text: '   ' });
    expect(result).toEqual({ ok: false, error: { kind: 'empty_input' } });
  });

  it('rejects invalid jobs before posting', async () => {
    const worker = fakeWorker();
    const result = await runImportInWorker(worker, { type: 'import.files', files: [] });
    expect(result).toMatchObject({ ok: false, error: { kind: 'worker_failed' } });
    expect(worker.posted).toEqual([]);
  });

  it('cancels through an AbortSignal', async () => {
    const worker = fakeWorker();
    const controller = new AbortController();
    const pending = runImportInWorker(
      worker,
      { type: 'import.files', files: [{ name: 'conversations.json', text: fixture('chatgpt/conversations.json') }] },
      { signal: controller.signal },
    );
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted' } });
  });

  it('resolves worker_failed when the worker crashes', async () => {
    const listeners: ((e: Event) => void)[] = [];
    const worker: WorkerLike = {
      postMessage: () => undefined,
      addEventListener: (type, l) => {
        if (type === 'error') listeners.push(l);
      },
      removeEventListener: () => undefined,
    };
    const pending = runImportInWorker(worker, { type: 'import.paste', text: 'hello world' });
    for (const l of listeners) l(new Event('error'));
    expect(await pending).toEqual({ ok: false, error: { kind: 'worker_failed', detail: 'import worker crashed' } });
  });

  it('ignores malformed and foreign messages', async () => {
    const listeners: ((e: Event) => void)[] = [];
    let jobId = '';
    const worker: WorkerLike = {
      postMessage: (m) => {
        jobId = (m as { jobId: string }).jobId;
      },
      addEventListener: (type, l) => {
        if (type === 'message') listeners.push(l);
      },
      removeEventListener: () => undefined,
    };
    const pending = runImportInWorker(worker, { type: 'import.paste', text: 'hello world' });
    const send = (data: unknown) => listeners.forEach((l) => l(new MessageEvent('message', { data })));
    send('garbage');
    send({ type: 'import.rejected', detail: 'x' });
    send({ type: 'import.failed', jobId: 'someone-else', error: { kind: 'aborted' } });
    send({ type: 'import.done', jobId, result: { vendor: 'nope' } });
    send({ type: 'import.failed', jobId, error: { kind: 'empty_input' } });
    expect(await pending).toEqual({ ok: false, error: { kind: 'empty_input' } });
  });
});
