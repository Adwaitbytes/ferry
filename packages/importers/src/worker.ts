import { attachImportWorker, type WorkerScopeLike } from './protocol.js';

/** Web Worker entry: `new Worker(new URL('@ferry/importers/worker', import.meta.url), { type: 'module' })`. */
export function isWorkerScope(scope: unknown): scope is WorkerScopeLike {
  // WorkerGlobalScope is absent from the DOM lib typings and from Node, so look it up at runtime.
  const ctor: unknown = Reflect.get(globalThis, 'WorkerGlobalScope');
  return typeof ctor === 'function' && scope instanceof ctor;
}

if (isWorkerScope(globalThis)) attachImportWorker(globalThis);
