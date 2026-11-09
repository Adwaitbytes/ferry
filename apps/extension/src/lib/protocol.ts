import type { CandidateFact, Suggestion } from '@ferry/core';

/*
 * Content-script response payloads (`WorkerResult<T>['data']`). Everything the side panel and the
 * web app can ask for has a frozen schema in @ferry/core (`PanelResponse`, `WebAppResponse`);
 * only the content-only messages keep extension-internal shapes here.
 */

export interface SuggestData {
  suggestions: Suggestion[];
}

export interface ComposeData {
  text: string;
  count: number;
}

export interface CaptureProposalData {
  proposal: { fact: CandidateFact; sensitive: boolean } | null;
  autoSaved: boolean;
}

/**
 * Messages the worker sends to a content script (never from the page). `ferry.insert-refs` comes
 * from the side panel's Now tab; the content script still composes through `inject.compose`, so
 * the worker checks the refs against what that tab was shown a second time.
 */
export type WorkerToContent =
  | { type: 'ferry.insert-suggested' }
  | { type: 'ferry.insert-refs'; refs: string[] };

/** The content script's answer to `ferry.insert-refs`: facts placed in the composer, 0 if none. */
export interface InsertReply {
  inserted: number;
}

const REF = /^[A-Za-z0-9_:-]{8,128}$/;

/** Even from our own worker, a command is shape checked before the content script acts on it. */
export function parseWorkerCommand(message: unknown): WorkerToContent | null {
  if (typeof message !== 'object' || message === null) return null;
  const m = message as { type?: unknown; refs?: unknown };
  if (m.type === 'ferry.insert-suggested') return { type: 'ferry.insert-suggested' };
  if (
    m.type === 'ferry.insert-refs' &&
    Array.isArray(m.refs) &&
    m.refs.length >= 1 &&
    m.refs.length <= 20 &&
    m.refs.every((r): r is string => typeof r === 'string' && REF.test(r))
  ) {
    return { type: 'ferry.insert-refs', refs: [...m.refs] };
  }
  return null;
}

export const IMPORT_PORT = 'ferry.import-progress';
