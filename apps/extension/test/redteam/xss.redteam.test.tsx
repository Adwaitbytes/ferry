// @vitest-environment jsdom
import { FactCard } from '@ferry/ui';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountHost } from '../../src/content/host';
import { renderCaptureToast, renderPreview } from '../../src/content/ui';
import { safeConversationLink } from '../../src/sidepanel/LibraryTab';

declare global {
  var __pwned: unknown;
}

afterEach(() => {
  cleanup();
  delete globalThis.__pwned;
});

describe('XSS in memory text', () => {
  it('RT-22 image onerror in side panel Library renders as text', () => {
    const fact = `<img src=x onerror="globalThis.__pwned=1">`;
    const { container } = render(
      <FactCard
        typeLabel="Preference"
        text={fact}
        status="active"
        sources={['chatgpt']}
        date="12 Oct 2026"
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(fact);
    expect(globalThis.__pwned).toBeUndefined();
  });

  it('RT-23 script tag in capture toast inside a closed shadow root renders as text', () => {
    const fact = `I like <script>globalThis.__pwned=1</script> jazz`;
    const ui = mountHost(document, '');
    const toast = renderCaptureToast(
      document,
      {
        id: '00000000-0000-4000-8000-000000000001',
        text: fact,
        type: 'preference',
        receipts: [
          {
            vendor: 'claude',
            conversationIdHash: 'abcdefgh',
            messageAt: '2026-10-12T10:00:00Z',
            quote: fact,
            quoteHash: 'abcdefgh',
            confidence: 0.9,
          },
        ],
        sensitive: [],
        flags: [],
      },
      false,
      { onSave: () => undefined, onDismiss: () => undefined },
    );
    ui.layer.append(toast);
    expect(ui.root.querySelector('script')).toBeNull();
    expect((ui.root.querySelector('textarea') as HTMLTextAreaElement).value).toBe(fact);
    expect(ui.host.shadowRoot).toBeNull();
    expect(globalThis.__pwned).toBeUndefined();
    ui.destroy();
  });

  it('RT-24 (adapted: the extension has no Markdown renderer) mutation XSS payload stays literal in the insert preview', () => {
    const md = `<math><mtext><table><mglyph><style><img src=x onerror="globalThis.__pwned=1">`;
    const ui = mountHost(document, '');
    ui.layer.append(
      renderPreview(
        document,
        [
          {
            ref: 'blob-aaaaaaaa1',
            text: md,
            type: 'preference',
            sources: ['claude'],
            heardAt: '2026-10-12',
            score: 1,
          },
        ],
        new Set(['blob-aaaaaaaa1']),
        {
          onToggle: () => undefined,
          onInsert: () => undefined,
          onCancel: () => undefined,
        },
      ),
    );
    expect(ui.root.querySelector('img')).toBeNull();
    expect(ui.root.querySelector('style')).toBeNull();
    expect(ui.root.querySelector('.ferry-fact-text')?.textContent).toBe(md);
    expect(globalThis.__pwned).toBeUndefined();
    ui.destroy();
  });

  it('receipt links stored in data are re-validated before rendering (companion to RT-25)', () => {
    // Built from fragments so the literal scheme never appears in source (lint no-script-url).
    expect(
      safeConversationLink(['java', 'script:alert(document.domain)'].join('')),
    ).toBeUndefined();
    expect(safeConversationLink('https://chatgpt.com.evil.example/c/1')).toBeUndefined();
    expect(safeConversationLink('https://user:pw@chatgpt.com/c/1')).toBeUndefined();
    expect(safeConversationLink('https://chatgpt.com/c/6731f0aa-3c2b-8000-9b1c-2a4f6d1e9b77')).toBe(
      'https://chatgpt.com/c/6731f0aa-3c2b-8000-9b1c-2a4f6d1e9b77',
    );
  });
});
