import {
  ALWAYS_BLOCKED,
  PanelResponse,
  formatContextBlock,
  keyFingerprint,
  type AdapterHealth,
  type CandidateFact,
  type ContentRequest,
  type ExportBundle,
  type ExtensionStatus,
  type GovernorStatus,
  type ImportEnqueued,
  type ImportProgress,
  type PairingConfirmation,
  type PairingOffer,
  type PanelRequest,
  type RecentCapture,
  type SaveResult,
  type Site,
  type WebAppRequest,
  type WorkerResult,
} from '@ferry/core';
import { screenCandidate } from '@ferry/distill';
import { z } from 'zod';
import { normalizeKeyHex } from '../lib/fingerprint';
import type { CaptureProposalData, ComposeData, SuggestData } from '../lib/protocol';
import { proposeCapture, screenEdited } from './capture';
import { MESSAGES, WorkerFailure, toWorkerError } from './errors';
import type {
  Clock,
  EngineFactory,
  FerryApi,
  ImportQueuePort,
  MemoryPort,
  StorageArea,
  VaultCrypto,
} from './ports';
import { RecallService } from './recall';
import { classifyExternal, classifyInternal, type SenderClass, type SenderLike } from './senders';
import { SettingsStore } from './settings';
import { isOtherClassType, parseFor } from './strict';
import { Vault } from './vault';

export const ACCOUNT_KEY = 'ferry.account';

const AccountRecord = z.object({
  accountId: z.string().regex(/^0x[0-9a-f]{64}$/),
  owner: z.string(),
  publicKeyHex: z.string().regex(/^[0-9a-f]{64}$/),
  pairedAt: z.iso.datetime(),
});
type AccountRecord = z.infer<typeof AccountRecord>;

const IDLE_PROGRESS: ImportProgress = { total: 0, written: 0, failed: 0, state: 'idle' };
const CAPTURE_INTERVAL_MS = 1500;
const PENDING_CAPTURE_TTL_MS = 30 * 60_000;
const RECENT_MAX = 12;

export interface ExportFormatter {
  toJson(memories: Awaited<ReturnType<MemoryPort['exportAll']>>): Promise<string>;
  toMarkdown(memories: Awaited<ReturnType<MemoryPort['exportAll']>>): string;
}

export interface WorkerDeps {
  extensionId: string;
  webOrigins: readonly string[];
  local: StorageArea;
  session: StorageArea;
  crypto: VaultCrypto;
  api: FerryApi;
  engines: EngineFactory;
  clock: Clock;
  exporter: ExportFormatter;
  newId(): string;
  openSidePanel(tabId: number): Promise<void>;
  wipeIndexedDb(): Promise<void>;
  deviceLabel(): string;
}

type Channel = 'internal' | 'external';

/**
 * The service worker's brain: sender classification, schema choice by sender, lock enforcement,
 * and one long-lived memory engine. No `chrome.*` here; `entrypoints/background.ts` wires it.
 */
export class FerryWorker {
  readonly vault: Vault;
  readonly settings: SettingsStore;
  private readonly recall: RecallService;
  private engine: MemoryPort | null = null;
  private imports: ImportQueuePort | null = null;
  private engineReady: Promise<void> | null = null;
  private readonly progressListeners = new Set<(p: ImportProgress) => void>();
  private unsubscribeImports: (() => void) | null = null;
  private adapters: Partial<Record<Site, AdapterHealth>> = {};
  private readonly pending = new Map<
    string,
    { tabId: number; site: Site; fact: CandidateFact; at: number }
  >();
  private readonly lastCaptureByTab = new Map<number, number>();
  private recent: RecentCapture[] = [];
  private coolingDownUntil = 0;

  constructor(private readonly deps: WorkerDeps) {
    this.settings = new SettingsStore(deps.local);
    this.recall = new RecallService(() => deps.clock.now());
    this.vault = new Vault({
      local: deps.local,
      session: deps.session,
      crypto: deps.crypto,
      clock: deps.clock,
      autoLockMs: async () => (await this.settings.get()).autoLockMinutes * 60_000,
      onOpen: (seed) => this.startEngine(seed),
      onLock: () => this.stopEngine(),
    });
  }

  /* ------------------------------ routing ------------------------------ */

  async route(raw: unknown, sender: SenderLike, channel: Channel): Promise<WorkerResult<unknown>> {
    const cls: SenderClass =
      channel === 'external'
        ? classifyExternal(sender, this.deps.webOrigins)
        : classifyInternal(sender, this.deps.extensionId);
    if (cls.kind === 'forbidden')
      return { ok: false, code: 'forbidden_sender', message: MESSAGES.forbidden };

    const parsed = parseFor(cls, raw);
    if (parsed === null) {
      // A known type from the wrong sender class is a privilege attempt, not a typo (X-MSG-2).
      return isOtherClassType(cls, raw)
        ? { ok: false, code: 'forbidden_sender', message: MESSAGES.forbidden }
        : { ok: false, code: 'invalid_message', message: MESSAGES.invalid };
    }

    try {
      let data: unknown;
      if (parsed.origin === 'content' && cls.kind === 'content') {
        if ('site' in parsed.message && parsed.message.site !== cls.site) {
          return { ok: false, code: 'forbidden_sender', message: MESSAGES.forbidden };
        }
        data = await this.handleContent(parsed.message, cls.tabId, cls.site);
      } else if (parsed.origin === 'extension_page') {
        data = conform(parsed.message.type, await this.handlePanel(parsed.message));
      } else if (parsed.origin === 'web_app') {
        data = conform(parsed.message.type, await this.handleWebApp(parsed.message));
      } else {
        return { ok: false, code: 'forbidden_sender', message: MESSAGES.forbidden };
      }
      return { ok: true, data };
    } catch (error) {
      const failure = toWorkerError(error);
      if (failure.code === 'cooling_down') {
        this.coolingDownUntil = this.deps.clock.now() + (failure.retryAfterMs ?? 10_000);
      }
      return failure;
    }
  }

  /** Whether a port connection for import progress may be accepted from this sender. */
  mayWatchImports(sender: SenderLike, channel: Channel): boolean {
    const cls =
      channel === 'external'
        ? classifyExternal(sender, this.deps.webOrigins)
        : classifyInternal(sender, this.deps.extensionId);
    return cls.kind === 'extension_page' || cls.kind === 'web_app';
  }

  onImportProgress(listener: (p: ImportProgress) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.imports?.progress() ?? IDLE_PROGRESS);
    return () => this.progressListeners.delete(listener);
  }

  forgetTab(tabId: number): void {
    this.recall.forgetTab(tabId);
    this.lastCaptureByTab.delete(tabId);
    for (const [id, p] of this.pending) if (p.tabId === tabId) this.pending.delete(id);
  }

  /* ------------------------------ handlers ------------------------------ */

  private async handleContent(msg: ContentRequest, tabId: number, site: Site): Promise<unknown> {
    switch (msg.type) {
      case 'adapter.health':
        this.adapters[site] = { ok: msg.ok, detail: msg.detail, at: this.deps.clock.now() };
        return { recorded: true };
      case 'panel.open':
        await this.deps.openSidePanel(tabId);
        return { opened: true };
      case 'recall.suggest':
        return this.suggest(tabId, site, msg.draft);
      case 'inject.compose':
        return this.compose(tabId, msg.refs);
      case 'capture.propose':
        return this.propose(tabId, site, msg.userText, msg.conversationUrl);
      case 'capture.save':
        return this.saveCapture(tabId, msg.fact);
    }
  }

  private async handlePanel(msg: PanelRequest): Promise<unknown> {
    switch (msg.type) {
      case 'lock':
        await this.vault.lock();
        return this.status();
      case 'unlock':
        await this.vault.open(msg.passphrase);
        return this.status();
      case 'settings.get':
        return this.settings.get();
      case 'settings.set': {
        const next = await this.settings.apply(msg.patch);
        if (next === null) throw new WorkerFailure('invalid_message', MESSAGES.invalid);
        return next;
      }
      case 'data.wipe':
        return this.wipe();
      default:
        return this.handleShared(msg);
    }
  }

  private async handleWebApp(msg: WebAppRequest): Promise<unknown> {
    if (msg.type === 'status.get') return this.status('web_app');
    return this.handleShared(msg);
  }

  /** Types both the side panel and the web app may send. */
  private async handleShared(
    msg:
      | Exclude<
          PanelRequest,
          { type: 'lock' | 'unlock' | 'settings.get' | 'settings.set' | 'data.wipe' }
        >
      | WebAppRequest,
  ): Promise<unknown> {
    switch (msg.type) {
      case 'status.get':
        return this.status();
      case 'pairing.begin':
        return this.pairingBegin();
      case 'pairing.confirm':
        return this.pairingConfirm(msg.accountId);
      case 'import.progress':
        return this.imports?.progress() ?? IDLE_PROGRESS;
      case 'import.enqueue': {
        const { imports } = await this.requireEngine();
        const allowed = msg.facts.filter(
          (f) => !f.sensitive.some((c) => ALWAYS_BLOCKED.includes(c)),
        );
        const { queued } = await imports.enqueue(allowed);
        const result: ImportEnqueued = { queued, dropped: msg.facts.length - allowed.length };
        return result;
      }
      case 'memory.list': {
        const { engine } = await this.requireEngine();
        return engine.list({
          ...(msg.status !== undefined ? { status: msg.status } : {}),
          ...(msg.query !== undefined ? { query: msg.query } : {}),
          ...(msg.cursor !== undefined ? { cursor: msg.cursor } : {}),
        });
      }
      case 'memory.recall': {
        const { engine } = await this.requireEngine();
        return engine.recallForDraft(msg.query, msg.limit);
      }
      case 'memory.save':
        return this.saveFact(msg.fact);
      case 'memory.hide': {
        const { engine } = await this.requireEngine();
        await engine.hide(msg.ref);
        this.recall.clear();
        return { hidden: msg.ref };
      }
      case 'memory.resolve': {
        const { engine } = await this.requireEngine();
        await engine.resolveConflict(msg.conflictId, msg.resolution);
        this.recall.clear();
        return { resolved: msg.conflictId };
      }
      case 'data.export':
        return this.exportData();
    }
  }

  /* ------------------------------ features ------------------------------ */

  private async suggest(tabId: number, site: Site, draft: string): Promise<SuggestData> {
    const settings = await this.settings.get();
    if (!settings.sites[site].inject) return { suggestions: [] };
    const wait = this.recall.retryAfter(tabId);
    if (wait > 0) throw new WorkerFailure('cooling_down', MESSAGES.coolingDown, wait);
    const { engine } = await this.requireEngine();
    const suggestions = await this.recall.suggest(tabId, site, draft, (q, k) =>
      engine.recallForDraft(q, k),
    );
    return { suggestions };
  }

  private async compose(tabId: number, refs: readonly string[]): Promise<ComposeData> {
    await this.vault.requireSeed();
    // Only refs this tab was shown can be composed, so a content script cannot enumerate memory.
    const texts = this.recall.shownTexts(tabId, refs);
    if (texts === null) throw new WorkerFailure('invalid_message', MESSAGES.invalid);
    const text = formatContextBlock(texts);
    return { text, count: text.length === 0 ? 0 : texts.length };
  }

  private async propose(
    tabId: number,
    site: Site,
    userText: string,
    conversationUrl: string | undefined,
  ): Promise<CaptureProposalData> {
    const settings = await this.settings.get();
    if (!settings.sites[site].capture) return { proposal: null, autoSaved: false };
    await this.requireEngine();
    const now = this.deps.clock.now();
    const last = this.lastCaptureByTab.get(tabId);
    if (last !== undefined && now - last < CAPTURE_INTERVAL_MS) {
      throw new WorkerFailure(
        'cooling_down',
        MESSAGES.coolingDown,
        last + CAPTURE_INTERVAL_MS - now,
      );
    }
    this.lastCaptureByTab.set(tabId, now);
    this.prunePending(now);

    const proposal = await proposeCapture(
      { site, userText, conversationUrl },
      {
        api: this.deps.api,
        site: settings.sites[site],
        now: () => this.deps.clock.now(),
        newId: this.deps.newId,
      },
    );
    if (proposal === null) return { proposal: null, autoSaved: false };

    if (proposal.autoSave) {
      const outcome = await this.saveFact(proposal.fact);
      const saved =
        outcome.status === 'written' ||
        outcome.status === 'pending' ||
        outcome.status === 'merged';
      this.remember({
        id: proposal.fact.id,
        site,
        text: proposal.fact.text,
        at: now,
        state: saved ? 'auto_saved' : 'failed',
      });
      if (saved) return { proposal: { fact: proposal.fact, sensitive: false }, autoSaved: true };
    }
    this.pending.set(proposal.fact.id, { tabId, site, fact: proposal.fact, at: now });
    this.remember({
      id: proposal.fact.id,
      site,
      text: proposal.fact.text,
      at: now,
      state: 'offered',
    });
    return { proposal: { fact: proposal.fact, sensitive: proposal.sensitive }, autoSaved: false };
  }

  /**
   * A content script may only save a fact the worker offered to that same tab. Type, receipts and
   * flags come from the worker's copy; only the text may change, and the edit is screened again.
   */
  private async saveCapture(tabId: number, submitted: CandidateFact): Promise<SaveResult> {
    const offered = this.pending.get(submitted.id);
    if (offered === undefined || offered.tabId !== tabId)
      throw new WorkerFailure('invalid_message', MESSAGES.invalid);
    const fact =
      submitted.text === offered.fact.text
        ? offered.fact
        : screenEdited(offered.fact, submitted.text);
    if (fact === null) {
      this.pending.delete(submitted.id);
      return { factId: submitted.id, status: 'quarantined' };
    }
    const outcome = await this.saveFact(fact);
    this.pending.delete(submitted.id);
    const state: RecentCapture['state'] =
      outcome.status === 'conflict'
        ? 'conflict'
        : outcome.status === 'failed' ||
            outcome.status === 'blocked' ||
            outcome.status === 'quarantined'
          ? 'failed'
          : 'saved';
    this.remember({
      id: fact.id,
      site: offered.site,
      text: fact.text,
      at: this.deps.clock.now(),
      state,
    });
    return outcome;
  }

  private async saveFact(fact: CandidateFact): Promise<SaveResult> {
    const screen = screenCandidate(fact.text);
    if (screen.verdict === 'blocked')
      return { factId: fact.id, status: 'blocked', categories: screen.sensitive };
    const { engine } = await this.requireEngine();
    const flags = [...new Set([...fact.flags, ...screen.flags])];
    const outcome = await engine.saveFact({ ...fact, flags });
    this.recall.clear();
    return outcome;
  }

  private async pairingBegin(): Promise<PairingOffer> {
    const record = await this.vault.record();
    if (record === null) throw new WorkerFailure('locked', MESSAGES.noVault);
    const account = await this.account();
    return {
      publicKeyHex: record.publicKeyHex,
      suiAddress: record.suiAddress,
      fingerprint: keyFingerprint(record.publicKeyHex),
      label: this.deps.deviceLabel(),
      accountId: account?.accountId ?? null,
    };
  }

  /** Saves the account only after the chain proxy shows our key registered on it and active. */
  private async pairingConfirm(accountId: string): Promise<PairingConfirmation> {
    const record = await this.vault.record();
    if (record === null) throw new WorkerFailure('locked', MESSAGES.noVault);
    const view = await this.deps.api.getAccount(accountId);
    if (
      view.accountId.toLowerCase().replace(/^0x0*/, '') !==
      accountId.toLowerCase().replace(/^0x0*/, '')
    ) {
      throw new WorkerFailure(
        'upstream',
        'The chain proxy returned a different account. Pairing was not saved.',
      );
    }
    if (!view.active)
      throw new WorkerFailure('not_paired', 'That Walrus Memory account is not active.');
    const registered = view.delegates.some((d) => decodeKey(d.publicKey) === record.publicKeyHex);
    if (!registered) {
      throw new WorkerFailure(
        'not_paired',
        'This browser key is not registered on that account yet. Sign the pairing transaction, then try again.',
      );
    }
    const account: AccountRecord = {
      accountId,
      owner: view.owner,
      publicKeyHex: record.publicKeyHex,
      pairedAt: new Date(this.deps.clock.now()).toISOString(),
    };
    await this.deps.local.set(ACCOUNT_KEY, AccountRecord.parse(account));
    if (this.vault.keyInMemory()) {
      this.stopEngine();
      await this.ensureEngine();
    }
    return { accountId, owner: view.owner };
  }

  private async exportData(): Promise<ExportBundle> {
    const { engine } = await this.requireEngine();
    const memories = await engine.exportAll();
    return {
      pam: await this.deps.exporter.toJson(memories),
      markdown: this.deps.exporter.toMarkdown(memories),
      count: memories.length,
    };
  }

  private async wipe(): Promise<ExtensionStatus> {
    await this.vault.lock();
    this.stopEngine();
    await this.deps.wipeIndexedDb();
    await this.deps.local.clear();
    await this.deps.session.clear();
    this.settings.reset();
    this.recall.clear();
    this.pending.clear();
    this.recent = [];
    this.adapters = {};
    return this.status();
  }

  /** The web app gets the same status minus adapter health and unsaved capture text. */
  async status(audience: 'panel' | 'web_app' = 'panel'): Promise<ExtensionStatus> {
    const [lock, record, account, settings] = await Promise.all([
      this.vault.state(),
      this.vault.record(),
      this.account(),
      this.settings.get(),
    ]);
    const status: ExtensionStatus = {
      lock,
      locked: lock !== 'open',
      paired: account !== null,
      accountId: account?.accountId ?? null,
      publicKeyHex: record?.publicKeyHex ?? null,
      fingerprint: record ? keyFingerprint(record.publicKeyHex) : null,
      suiAddress: record?.suiAddress ?? null,
      account: account
        ? { accountId: account.accountId, owner: account.owner, pairedAt: account.pairedAt }
        : null,
      autoLockMinutes: settings.autoLockMinutes,
      msUntilAutoLock: await this.vault.msUntilAutoLock(),
      governor: this.governor(),
      importProgress: this.imports?.progress() ?? IDLE_PROGRESS,
    };
    if (audience === 'web_app') return status;
    return { ...status, adapters: { ...this.adapters }, recentCaptures: [...this.recent] };
  }

  /** The engine's governor when one runs; otherwise the last cooldown the worker observed. */
  private governor(): GovernorStatus {
    const engineState = this.engine?.governor();
    if (engineState !== undefined && engineState.kind !== 'ready') return engineState;
    const now = this.deps.clock.now();
    if (this.coolingDownUntil > now)
      return { kind: 'cooling_down', reason: 'rate_limited', resumeAt: this.coolingDownUntil };
    return { kind: 'ready' };
  }

  /* ------------------------------ engine lifecycle ------------------------------ */

  private async account(): Promise<AccountRecord | null> {
    const parsed = AccountRecord.safeParse(await this.deps.local.get(ACCOUNT_KEY));
    return parsed.success ? parsed.data : null;
  }

  private async requireEngine(): Promise<{ engine: MemoryPort; imports: ImportQueuePort }> {
    await this.vault.requireSeed();
    await this.ensureEngine();
    if (this.engine === null || this.imports === null)
      throw new WorkerFailure('not_paired', MESSAGES.notPaired);
    return { engine: this.engine, imports: this.imports };
  }

  private async ensureEngine(): Promise<void> {
    if (this.engine !== null) return;
    if (this.engineReady === null) {
      this.engineReady = (async () => {
        const account = await this.account();
        if (account === null || !this.vault.keyInMemory()) return;
        const seed = await this.vault.requireSeed();
        const { engine, imports } = await this.deps.engines.create({
          seed,
          accountId: account.accountId,
        });
        this.engine = engine;
        this.imports = imports;
        this.unsubscribeImports = imports.subscribe((p) => {
          for (const listener of this.progressListeners) listener(p);
        });
      })().finally(() => {
        this.engineReady = null;
      });
    }
    await this.engineReady;
  }

  private async startEngine(_seed: Uint8Array): Promise<void> {
    try {
      await this.ensureEngine();
    } catch (error) {
      // Opening must still succeed when the engine cannot start (for example, relayer down);
      // the next privileged call retries and reports a proper error.
      this.stopEngine();
      if (!(error instanceof WorkerFailure)) console.warn('Ferry engine failed to start');
    }
  }

  private stopEngine(): void {
    this.unsubscribeImports?.();
    this.unsubscribeImports = null;
    this.engine?.destroy();
    this.engine = null;
    this.imports = null;
    this.recall.clear();
    this.pending.clear();
  }

  private prunePending(now: number): void {
    for (const [id, p] of this.pending)
      if (now - p.at > PENDING_CAPTURE_TTL_MS) this.pending.delete(id);
  }

  private remember(entry: RecentCapture): void {
    this.recent = [entry, ...this.recent.filter((r) => r.id !== entry.id)].slice(0, RECENT_MAX);
  }
}

/** The chain proxy may return delegate keys as hex or base64; compare as lowercase hex. */
export function decodeKey(value: string): string | null {
  const hex = normalizeKeyHex(value);
  if (hex !== null) return hex;
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    if (bin.length !== 32) return null;
    return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Every panel and web app response is parsed with its frozen core schema before it leaves the
 * worker, so a drifted shape fails here as an internal error instead of confusing a caller.
 */
function conform(type: PanelRequest['type'] | WebAppRequest['type'], data: unknown): unknown {
  if (type === 'settings.get' || type === 'settings.set') return data;
  const parsed = PanelResponse[type].safeParse(data);
  if (!parsed.success) throw new WorkerFailure('internal', MESSAGES.internal);
  return parsed.data;
}
