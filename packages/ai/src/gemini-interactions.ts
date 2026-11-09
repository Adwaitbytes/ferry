import type { DeskProvider, DeskRequest } from '@ferry/core';
import { buildDeskMessages, DESK_SYSTEM } from './desk.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const DEFAULT_GEMINI_INTERACTIONS_MODEL = 'gemini-3.5-flash';

type Step = { type: 'user_input' | 'model_output'; content: { type: 'text'; text: string }[] };

/**
 * Google AI Studio keys that start with "AQ." are scoped to the Interactions API and get a 404
 * from generateContent, so Desk talks to Gemini through Interactions for those keys. The thread is
 * sent as steps; the system rules travel with the first user step because the step format has no
 * separate system slot.
 */
export function toInteractionSteps(req: DeskRequest): Step[] {
  return buildDeskMessages(req).map((m, i) => ({
    type: m.role === 'user' ? 'user_input' : 'model_output',
    content: [{ type: 'text', text: i === 0 ? `${DESK_SYSTEM}\n\n${m.content}` : m.content }],
  }));
}

export function readInteractionText(body: unknown): string {
  const steps = (body as { steps?: { type?: string; content?: { type?: string; text?: string }[] }[] }).steps ?? [];
  return steps
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

export function usesInteractionsKey(apiKey: string | undefined): boolean {
  return typeof apiKey === 'string' && apiKey.startsWith('AQ.');
}

export async function deskViaInteractions(
  req: DeskRequest,
  opts: { apiKey: string; model?: string; served: DeskProvider; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Response> {
  const res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({ model: opts.model ?? DEFAULT_GEMINI_INTERACTIONS_MODEL, input: toInteractionSteps(req) }),
    signal: opts.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`interactions ${res.status}`);
  const text = readInteractionText(await res.json());
  if (!text) throw new Error('interactions returned no text');
  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-ferry-provider': opts.served, 'cache-control': 'no-store' },
  });
}
