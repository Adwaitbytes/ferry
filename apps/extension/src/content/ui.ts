import {
  MAX_FACT_CHARS,
  formatContextBlock,
  type CandidateFact,
  type Suggestion,
  type Vendor,
} from '@ferry/core';
import { el, ferryMark, icon } from './dom';

const VENDOR_LABEL: Record<Vendor, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  paste: 'Paste',
  desk: 'Ferry Desk',
  manual: 'Ferry',
};

export function chipLabel(count: number, assistant: string): string {
  return count === 1
    ? `Ferry has 1 thing ${assistant} should know`
    : `Ferry has ${count} things ${assistant} should know`;
}

export function formatHeard(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type ChipView =
  | { kind: 'ready'; count: number; assistant: string; expanded: boolean }
  | { kind: 'loading' }
  | { kind: 'locked' }
  | { kind: 'added'; count: number };

export function renderChip(
  doc: Document,
  view: ChipView,
  onClick: () => void,
  narrow: boolean,
): HTMLButtonElement {
  const button = el(doc, 'button', { className: 'ferry-chip', attrs: { type: 'button' } });
  if (narrow) button.setAttribute('data-narrow', 'true');
  switch (view.kind) {
    case 'ready': {
      const label = chipLabel(view.count, view.assistant);
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', String(view.expanded));
      button.setAttribute('aria-label', `${label}. Press Alt I to insert.`);
      button.append(
        ferryMark(doc),
        el(doc, 'span', { className: 'ferry-chip-label', text: label }),
        el(doc, 'kbd', { className: 'ferry-kbd', text: 'Alt I' }),
      );
      break;
    }
    case 'loading':
      button.setAttribute('aria-busy', 'true');
      button.append(
        icon(doc, 'loader-circle'),
        el(doc, 'span', { className: 'ferry-chip-label', text: 'Checking your Ferry memory' }),
      );
      button.firstElementChild?.classList.add('ferry-spin');
      break;
    case 'locked':
      button.setAttribute('aria-label', 'Ferry is locked. Open the side panel to continue.');
      button.append(
        icon(doc, 'lock'),
        el(doc, 'span', {
          className: 'ferry-chip-label',
          text: 'Ferry is locked. Open the side panel to continue.',
        }),
      );
      break;
    case 'added':
      button.append(
        icon(doc, 'check'),
        el(doc, 'span', {
          className: 'ferry-chip-label',
          text: view.count === 1 ? 'Added 1 fact' : `Added ${view.count} facts`,
        }),
      );
      break;
  }
  button.addEventListener('click', onClick);
  return button;
}

export interface PreviewHandlers {
  onToggle(ref: string, on: boolean): void;
  onInsert(): void;
  onCancel(): void;
}

export function renderPreview(
  doc: Document,
  suggestions: readonly Suggestion[],
  selected: ReadonlySet<string>,
  handlers: PreviewHandlers,
): HTMLDivElement {
  const titleId = 'ferry-preview-title';
  const chosen = suggestions.filter((s) => selected.has(s.ref));
  const rows = suggestions.map((s) => {
    const id = `ferry-fact-${s.ref.replace(/[^A-Za-z0-9_-]/g, '')}`;
    const box = el(doc, 'input', { attrs: { type: 'checkbox', id } });
    box.checked = selected.has(s.ref);
    box.addEventListener('change', () => handlers.onToggle(s.ref, box.checked));
    const sources = s.sources.map((v) =>
      el(
        doc,
        'span',
        { className: 'ferry-source', attrs: { 'aria-label': `Source: ${VENDOR_LABEL[v]}` } },
        [
          el(doc, 'span', {
            className: 'ferry-dot',
            attrs: { 'data-vendor': v, 'aria-hidden': 'true' },
          }),
          VENDOR_LABEL[v],
        ],
      ),
    );
    return el(doc, 'div', { className: 'ferry-fact' }, [
      box,
      el(doc, 'label', { attrs: { for: id } }, [
        el(doc, 'span', { className: 'ferry-fact-text', text: s.text }),
        el(doc, 'span', { className: 'ferry-receipt' }, [
          ...sources,
          `Heard ${formatHeard(s.heardAt)}`,
        ]),
      ]),
    ]);
  });

  const block = formatContextBlock(chosen.map((s) => s.text)).trimEnd();
  const insert = el(doc, 'button', {
    className: 'ferry-btn ferry-btn-primary',
    attrs: { type: 'button' },
    text: chosen.length === 1 ? 'Insert 1 fact' : `Insert ${chosen.length} facts`,
  });
  if (chosen.length === 0) insert.setAttribute('aria-disabled', 'true');
  insert.addEventListener('click', () => {
    if (chosen.length > 0) handlers.onInsert();
  });
  const cancel = el(doc, 'button', {
    className: 'ferry-btn ferry-btn-ghost',
    attrs: { type: 'button' },
    text: 'Cancel',
  });
  cancel.addEventListener('click', handlers.onCancel);

  return el(
    doc,
    'div',
    { className: 'ferry-preview', attrs: { role: 'dialog', 'aria-labelledby': titleId } },
    [
      el(doc, 'div', {
        className: 'ferry-preview-head',
        attrs: { id: titleId },
        text: 'Add context to this message',
      }),
      el(doc, 'div', { className: 'ferry-preview-body' }, [
        ...rows,
        el(doc, 'pre', {
          className: 'ferry-code',
          attrs: { 'aria-label': 'Exact text that will be inserted' },
          text: block.length > 0 ? block : 'Pick at least one fact to insert.',
        }),
      ]),
      el(doc, 'div', { className: 'ferry-actions' }, [cancel, insert]),
    ],
  );
}

export interface ToastHandlers {
  onSave(text: string): void;
  onDismiss(): void;
}

/**
 * "Save to Ferry" capture toast (DESIGN 7.10). The text the user saves is read from this closure's
 * textarea at click time, never from anything the page can reach (closed shadow root).
 */
export function renderCaptureToast(
  doc: Document,
  fact: CandidateFact,
  sensitive: boolean,
  handlers: ToastHandlers,
): HTMLDivElement {
  const area = el(doc, 'textarea', {
    attrs: { id: 'ferry-capture-text', maxlength: String(MAX_FACT_CHARS), rows: '2' },
  });
  area.value = fact.text;
  const count = el(doc, 'span', { text: `${Array.from(fact.text).length} of ${MAX_FACT_CHARS}` });
  area.addEventListener('input', () => {
    count.textContent = `${Array.from(area.value).length} of ${MAX_FACT_CHARS}`;
  });
  const save = el(doc, 'button', {
    className: 'ferry-btn ferry-btn-primary',
    attrs: { type: 'button' },
    text: 'Save',
  });
  save.addEventListener('click', () => {
    const text = area.value.trim();
    if (text.length > 0) handlers.onSave(text);
  });
  const later = el(doc, 'button', {
    className: 'ferry-btn ferry-btn-ghost',
    attrs: { type: 'button' },
    text: 'Not now',
  });
  later.addEventListener('click', handlers.onDismiss);

  return el(
    doc,
    'div',
    {
      className: 'ferry-toast',
      attrs: { role: 'dialog', 'aria-labelledby': 'ferry-capture-title' },
    },
    [
      el(doc, 'div', { className: 'ferry-toast-title', attrs: { id: 'ferry-capture-title' } }, [
        ferryMark(doc, 16),
        'Save this to Ferry?',
      ]),
      el(doc, 'label', { attrs: { for: 'ferry-capture-text' }, text: 'Fact' }),
      area,
      el(doc, 'div', { className: 'ferry-toast-meta' }, [
        'Ferry only saves your own messages, and only when you say so.',
        count,
      ]),
      sensitive
        ? el(doc, 'div', { className: 'ferry-note' }, [
            icon(doc, 'shield-question'),
            'This looks like a sensitive detail. It is only saved if you choose Save.',
          ])
        : null,
      el(doc, 'div', { className: 'ferry-actions' }, [later, save]),
    ],
  );
}

export function renderToastStatus(
  doc: Document,
  tone: 'ok' | 'warn',
  message: string,
  onClose: () => void,
): HTMLDivElement {
  const close = el(
    doc,
    'button',
    { className: 'ferry-btn ferry-btn-ghost', attrs: { type: 'button', 'aria-label': 'Close' } },
    [icon(doc, 'x')],
  );
  close.addEventListener('click', onClose);
  return el(
    doc,
    'div',
    { className: 'ferry-toast', attrs: { role: tone === 'ok' ? 'status' : 'alert' } },
    [
      el(doc, 'div', { className: 'ferry-toast-status', attrs: { 'data-tone': tone } }, [
        icon(doc, tone === 'ok' ? 'check' : 'circle-slash', 16),
        el(doc, 'span', { className: 'ferry-grow', text: message }),
        close,
      ]),
    ],
  );
}

export function renderDegraded(doc: Document, assistant: string): HTMLDivElement {
  return el(
    doc,
    'div',
    {
      className: 'ferry-degraded',
      attrs: {
        role: 'status',
        title: `Ferry cannot read this page's layout right now. ${assistant} may have changed it. Your chats are not affected.`,
      },
    },
    [icon(doc, 'circle-slash', 12), 'Ferry adapter degraded'],
  );
}
