import { setAdapterErrorReporter, type SiteAdapter } from '@ferry/adapters';
import type { CandidateFact, ContentRequest, Site, Suggestion, WorkerResult } from '@ferry/core';
import { SITE_LABEL } from '../lib/config';
import type {
  CaptureProposalData,
  ComposeData,
  SaveOutcomeData,
  SuggestData,
} from '../lib/protocol';
import { clear, el } from './dom';
import { injectFontFace, mountHost, type FerryHost } from './host';
import {
  renderCaptureToast,
  renderChip,
  renderDegraded,
  renderPreview,
  renderToastStatus,
  type ChipView,
} from './ui';

/** PRD F3: recall after a 600 ms typing pause. */
export const TYPING_PAUSE_MS = 600;
/** DESIGN 7.11: the loading chip only appears if recall takes longer than this. */
const LOADING_AFTER_MS = 400;
const ADDED_FOR_MS = 2000;
const STATUS_TOAST_MS = 5000;
const HEALTH_EVERY_MS = 15_000;
const CHIP_HEIGHT = 28;
const NARROW_COMPOSER_PX = 360;
const MAX_SENT_CHARS = 8000;

export type Send = (message: ContentRequest) => Promise<WorkerResult<unknown>>;

export interface ContentDeps {
  site: Site;
  adapter: SiteAdapter;
  doc: Document;
  send: Send;
  cssText: string;
  fontUrl: string;
}

export interface FerryContent {
  /** Alt+I from the worker: insert every current suggestion without opening the preview. */
  insertSuggested(): Promise<void>;
  destroy(): void;
}

/**
 * Composer chip, insert preview, capture toast and degraded notice for one chat tab. All page DOM
 * access goes through the site adapter; everything Ferry renders lives in one closed shadow root.
 * This script never listens to window messages and never posts any (RT-39).
 */
export function startFerry(deps: ContentDeps): FerryContent {
  const { doc, adapter, site } = deps;
  const assistant = SITE_LABEL[site];
  const view = doc.defaultView;
  let ui: FerryHost | null = null;
  let chipWell: HTMLDivElement | null = null;
  let preview: HTMLDivElement | null = null;
  let toast: HTMLDivElement | null = null;
  let degraded: HTMLDivElement | null = null;

  let suggestions: Suggestion[] = [];
  let selected = new Set<string>();
  let chip: ChipView | null = null;
  let dismissed = false;
  let inserted = false;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  let loadingTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let recallSeq = 0;
  let lastHealth: string | null = null;
  let destroyed = false;

  const ensureUi = (): FerryHost => {
    if (ui === null) {
      injectFontFace(doc, deps.fontUrl);
      ui = mountHost(doc, deps.cssText);
    }
    ui.setTheme(safe(() => adapter.theme(doc), 'light'));
    return ui;
  };

  /* -------------------------------- chip -------------------------------- */

  const composer = (): HTMLElement | null => safe(() => adapter.findComposer(doc), null);

  const placeChip = (): void => {
    const c = composer();
    if (chipWell === null || c === null) return;
    const rect = safe(() => adapter.anchorRect(c), null);
    if (rect === null) return;
    chipWell.style.setProperty('left', `${Math.max(8, rect.x)}px`);
    chipWell.style.setProperty('top', `${Math.max(8, rect.y - CHIP_HEIGHT)}px`);
    chipWell.style.setProperty('max-width', `${Math.max(160, rect.width)}px`);
    if (preview !== null) {
      preview.style.setProperty('left', `${Math.max(8, rect.x)}px`);
      preview.style.setProperty(
        'bottom',
        `${Math.max(8, (view?.innerHeight ?? 800) - rect.y + CHIP_HEIGHT + 8)}px`,
      );
    }
  };

  const renderChipNow = (enter: boolean): void => {
    if (chip === null) {
      chipWell?.remove();
      chipWell = null;
      closePreview();
      return;
    }
    const host = ensureUi();
    if (chipWell === null) {
      chipWell = el(doc, 'div', { className: 'ferry-chip-well' });
      host.layer.append(chipWell);
    }
    const c = composer();
    const narrow = c !== null && c.getBoundingClientRect().width < NARROW_COMPOSER_PX;
    const button = renderChip(doc, chip, onChipClick, narrow);
    if (enter) button.setAttribute('data-enter', 'true');
    clear(chipWell);
    chipWell.append(button);
    placeChip();
    if (enter) view?.requestAnimationFrame(() => button.removeAttribute('data-enter'));
  };

  const setChip = (next: ChipView | null): void => {
    const entering = chip === null && next !== null;
    chip = next;
    renderChipNow(entering);
  };

  const onChipClick = (): void => {
    if (chip?.kind === 'locked') {
      void deps.send({ type: 'panel.open' });
      return;
    }
    if (chip?.kind !== 'ready') return;
    if (preview !== null) closePreview();
    else openPreview();
  };

  const openPreview = (): void => {
    const host = ensureUi();
    preview?.remove();
    preview = renderPreview(doc, suggestions, selected, {
      onToggle: (ref, on) => {
        if (on) selected.add(ref);
        else selected.delete(ref);
        openPreview();
      },
      onInsert: () => void insert([...selected]),
      onCancel: closePreview,
    });
    host.layer.append(preview);
    if (chip?.kind === 'ready') chip = { ...chip, expanded: true };
    renderChipNow(false);
  };

  const closePreview = (): void => {
    preview?.remove();
    preview = null;
    if (chip?.kind === 'ready' && chip.expanded) {
      chip = { ...chip, expanded: false };
      renderChipNow(false);
    }
  };

  const insert = async (refs: string[]): Promise<void> => {
    const c = composer();
    if (refs.length === 0 || c === null) return;
    const res = await deps.send({ type: 'inject.compose', site, refs });
    if (!res.ok) {
      if (res.code === 'locked') setChip({ kind: 'locked' });
      return;
    }
    const { text, count } = res.data as ComposeData;
    if (text.length === 0 || !safe(() => adapter.insertAtStart(c, text), false)) return;
    inserted = true;
    closePreview();
    setChip({ kind: 'added', count });
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setChip(null), ADDED_FOR_MS);
  };

  /* -------------------------------- recall -------------------------------- */

  const recall = async (): Promise<void> => {
    const c = composer();
    if (c === null || dismissed || inserted) return;
    const draft = safe(() => adapter.readDraft(c), '').trim();
    if (draft.length < 3) {
      setChip(null);
      return;
    }
    const seq = ++recallSeq;
    if (loadingTimer !== null) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      if (seq === recallSeq && chip === null) setChip({ kind: 'loading' });
    }, LOADING_AFTER_MS);
    const res = await deps.send({ type: 'recall.suggest', site, draft: draft.slice(-4000) });
    if (loadingTimer !== null) clearTimeout(loadingTimer);
    if (seq !== recallSeq || destroyed) return;
    if (!res.ok) {
      if (res.code === 'locked') setChip({ kind: 'locked' });
      else if (chip?.kind === 'loading') setChip(null);
      return;
    }
    suggestions = (res.data as SuggestData).suggestions;
    // Silence is the empty state (DESIGN 7.11).
    if (suggestions.length === 0) {
      setChip(null);
      return;
    }
    selected = new Set(suggestions.map((s) => s.ref));
    const expanded = preview !== null;
    setChip({ kind: 'ready', count: suggestions.length, assistant, expanded });
    if (expanded) openPreview();
  };

  const onInput = (event: Event): void => {
    const c = composer();
    const target = event.target;
    if (c === null || !(target instanceof Node) || !c.contains(target)) return;
    if (typingTimer !== null) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => void recall(), TYPING_PAUSE_MS);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || chip === null) return;
    if (preview !== null) {
      closePreview();
      event.stopPropagation();
      return;
    }
    dismissed = true;
    setChip(null);
  };

  /* -------------------------------- capture -------------------------------- */

  const clearToast = (): void => {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = null;
    toast?.remove();
    toast = null;
  };

  /** Keeps the toast off the composer: if they would overlap, it moves above the composer. */
  const placeToast = (node: HTMLDivElement): void => {
    const c = composer();
    if (c === null || view === null) return;
    const box = c.getBoundingClientRect();
    const toastRect = node.getBoundingClientRect();
    const overlaps =
      toastRect.left < box.right &&
      toastRect.right > box.left &&
      toastRect.top < box.bottom &&
      toastRect.bottom > box.top;
    if (overlaps)
      node.style.setProperty('bottom', `${Math.max(16, view.innerHeight - box.top + 16)}px`);
  };

  const showToast = (node: HTMLDivElement, autoHideMs: number | null): void => {
    clearToast();
    const host = ensureUi();
    toast = node;
    node.setAttribute('data-enter', 'true');
    host.layer.append(node);
    placeToast(node);
    view?.requestAnimationFrame(() => node.removeAttribute('data-enter'));
    if (autoHideMs !== null) toastTimer = setTimeout(clearToast, autoHideMs);
  };

  const status = (tone: 'ok' | 'warn', message: string): void =>
    showToast(renderToastStatus(doc, tone, message, clearToast), STATUS_TOAST_MS);

  const onSent = async (text: string): Promise<void> => {
    dismissed = false;
    inserted = false;
    suggestions = [];
    setChip(null);
    const conversationUrl = safe(() => adapter.conversationUrl(doc.location), undefined);
    const res = await deps.send({
      type: 'capture.propose',
      site,
      userText: text.slice(0, MAX_SENT_CHARS),
      ...(conversationUrl !== undefined ? { conversationUrl } : {}),
    });
    if (!res.ok || destroyed) return;
    const { proposal, autoSaved } = res.data as Partial<CaptureProposalData>;
    if (proposal === null || proposal === undefined) return;
    if (autoSaved) {
      status('ok', 'Saved to Ferry automatically.');
      return;
    }
    showToast(
      renderCaptureToast(doc, proposal.fact, proposal.sensitive, {
        onSave: (edited) => void save(proposal.fact, edited),
        onDismiss: clearToast,
      }),
      null,
    );
  };

  const save = async (fact: CandidateFact, text: string): Promise<void> => {
    const res = await deps.send({ type: 'capture.save', site, fact: { ...fact, text } });
    if (!res.ok) {
      status(
        'warn',
        res.code === 'locked'
          ? 'Ferry is locked. Open the side panel to continue.'
          : 'Could not save this fact. Try again from the side panel.',
      );
      return;
    }
    const outcome = res.data as SaveOutcomeData;
    switch (outcome.kind) {
      case 'written':
      case 'pending':
        status('ok', 'Saved to Ferry. It is on its way to Walrus.');
        break;
      case 'merged':
        status('ok', 'Ferry already knew this. Added this chat as another receipt.');
        break;
      case 'conflict':
        status(
          'warn',
          'This disagrees with a fact you saved before. Resolve it in the side panel.',
        );
        break;
      case 'quarantined':
        status('warn', 'Not saved. Flagged as possible instructions.');
        break;
      case 'blocked':
        status('warn', 'Not saved. Ferry never stores card numbers, government ids or passwords.');
        break;
      case 'failed':
        status('warn', 'Could not save this fact. Try again from the side panel.');
        break;
    }
  };

  /* -------------------------------- health -------------------------------- */

  const checkHealth = (): void => {
    const health = safe(() => adapter.health(doc), {
      ok: false,
      detail: 'Adapter health check failed',
    });
    const key = `${health.ok}:${health.detail}`;
    if (key === lastHealth) return;
    lastHealth = key;
    void deps.send({
      type: 'adapter.health',
      site,
      ok: health.ok,
      detail: health.detail.slice(0, 200),
    });
    if (health.ok) {
      degraded?.remove();
      degraded = null;
    } else if (degraded === null) {
      degraded = renderDegraded(doc, assistant);
      ensureUi().layer.append(degraded);
    }
  };

  /* -------------------------------- wiring -------------------------------- */

  doc.addEventListener('input', onInput, true);
  doc.addEventListener('keydown', onKeydown, true);
  const onLayout = (): void => placeChip();
  view?.addEventListener('resize', onLayout);
  view?.addEventListener('scroll', onLayout, true);
  const stopObserving = safe(
    () => adapter.observeUserMessages(doc, (msg) => void onSent(msg.text)),
    () => undefined,
  );
  // Contained adapter errors become a degraded report instead of console noise in the page.
  setAdapterErrorReporter((context) => {
    lastHealth = null;
    void deps.send({
      type: 'adapter.health',
      site,
      ok: false,
      detail: `Adapter error in ${context}`.slice(0, 200),
    });
  });
  checkHealth();
  const healthTimer = setInterval(checkHealth, HEALTH_EVERY_MS);

  return {
    async insertSuggested() {
      if (chip?.kind !== 'ready' || suggestions.length === 0) return;
      await insert(suggestions.map((s) => s.ref));
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('keydown', onKeydown, true);
      view?.removeEventListener('resize', onLayout);
      view?.removeEventListener('scroll', onLayout, true);
      stopObserving();
      setAdapterErrorReporter(null);
      clearInterval(healthTimer);
      for (const t of [typingTimer, loadingTimer, hideTimer, toastTimer])
        if (t !== null) clearTimeout(t);
      ui?.destroy();
      ui = null;
    },
  };
}

/** Adapter calls touch a hostile, changing DOM. A throw must degrade Ferry, never the page. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
