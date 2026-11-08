import type { SiteAdapter } from '@ferry/adapters';
import type { ContentRequest, WorkerResult } from '@ferry/core';
import { vi } from 'vitest';
import { suggestion } from './helpers';

/** A minimal adapter over a plain textarea, so controller behavior is tested without vendor DOM. */
export function textareaAdapter(
  doc: Document,
): SiteAdapter & { sent: ((text: string) => void) | null } {
  const adapter = {
    sent: null as ((text: string) => void) | null,
    site: 'claude' as const,
    matches: () => true,
    health: () => ({ ok: true, detail: 'ok' }),
    probe: () => ({ composer: null, userTurns: null }),
    findComposer: (d: Document) => d.querySelector<HTMLElement>('textarea#composer'),
    readDraft: (c: HTMLElement) => (c as HTMLTextAreaElement).value,
    insertAtStart: (c: HTMLElement, text: string) => {
      const area = c as HTMLTextAreaElement;
      area.value = text + area.value;
      return true;
    },
    observeUserMessages: (_d: Document, onSent: (m: { text: string; at: Date }) => void) => {
      adapter.sent = (text) => onSent({ text, at: new Date() });
      return () => {
        adapter.sent = null;
      };
    },
    conversationUrl: () => 'https://claude.ai/chat/abc',
    theme: () => 'dark' as const,
    anchorRect: () => new DOMRect(10, 500, 600, 0),
  };
  void doc;
  return adapter;
}

export function fakeSend(): ReturnType<
  typeof vi.fn<(m: ContentRequest) => Promise<WorkerResult<unknown>>>
> {
  return vi.fn(async (m: ContentRequest): Promise<WorkerResult<unknown>> => {
    switch (m.type) {
      case 'recall.suggest':
        return {
          ok: true,
          data: {
            suggestions: [
              suggestion('blob-aaaaaaaa1', 'Vegetarian'),
              suggestion('blob-aaaaaaaa2', 'Allergic to cashews'),
            ],
          },
        };
      case 'inject.compose':
        return { ok: true, data: { text: '[ctx]\n- Vegetarian\n[end]\n\n', count: m.refs.length } };
      case 'capture.propose':
        return { ok: true, data: { proposal: null, autoSaved: false } };
      default:
        return { ok: true, data: { recorded: true } };
    }
  });
}
