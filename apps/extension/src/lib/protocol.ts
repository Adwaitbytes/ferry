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

/** Messages the worker sends to a content script (never from the page). */
export type WorkerToContent = { type: 'ferry.insert-suggested' };

export const IMPORT_PORT = 'ferry.import-progress';
