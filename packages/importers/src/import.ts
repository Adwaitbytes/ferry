import { MAX_CHUNK_CHARS, hashShort } from '@ferry/core';
import { chatGptProfileConversation, parseChatGptConversation } from './chatgpt.js';
import { chunkConversation } from './chunk.js';
import { parseClaudeConversation, parseClaudeMemories, parseClaudeProjects } from './claude.js';
import { parseGeminiHtml, parseGeminiJson } from './gemini.js';
import { MAX_PASTE_CHARS, splitPasteCandidates } from './paste.js';
import { isRecord } from './text.js';
import type {
  ChunkSource,
  DistillChunk,
  ImportOptions,
  ImportProgressEvent,
  ImportResult,
  ImportVendor,
  NormalizedConversation,
  Result,
} from './types.js';
import { err, ok } from './types.js';
import { createTicker } from './yield.js';
import { ZIP_LIMITS, inflateEntryText, listZipEntries, type ZipLimits } from './zip.js';

export type ExportPlan =
  | { vendor: 'chatgpt' | 'claude' | 'unknown'; conversations: string[]; projects?: string; memories?: string }
  | { vendor: 'gemini'; files: string[] };

export interface TextFile {
  name: string;
  text: string;
}

const CONVERSATIONS_SHARD = /^conversations-\d{1,4}\.json$/;
const isConversationsFile = (base: string): boolean => base === 'conversations.json' || CONVERSATIONS_SHARD.test(base);
const CLAUDE_MARKERS = ['users.json', 'projects.json', 'memories.json'];
const CHATGPT_MARKERS = ['chat.html', 'user.json', 'message_feedback.json', 'shared_conversations.json'];
const MAX_GEMINI_FILES = 4;

function splitPath(name: string): { dir: string; base: string; segments: string[] } {
  const segments = name.split('/').filter((s) => s.length > 0);
  const base = segments.at(-1) ?? '';
  return { dir: segments.slice(0, -1).join('/'), base, segments };
}

function isNoise(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.endsWith('/') || splitPath(name).base.startsWith('._');
}

/**
 * Decides which files to read, from names alone, so nothing else in the archive is ever inflated.
 * Files must sit at the archive root or inside one wrapper folder, matching how vendors ship them.
 */
export function planExport(names: readonly string[]): ExportPlan | null {
  const files = names.filter((n) => !isNoise(n));
  const byDir = new Map<string, string[]>();
  for (const name of files) {
    const { dir, segments } = splitPath(name);
    if (segments.length > 2) continue;
    byDir.set(dir, [...(byDir.get(dir) ?? []), name]);
  }
  const dirs = [...byDir.keys()].sort((a, b) => a.length - b.length);
  for (const dir of dirs) {
    const inDir = byDir.get(dir) ?? [];
    const bases = new Map(inDir.map((n) => [splitPath(n).base, n]));
    const conversations = inDir.filter((n) => isConversationsFile(splitPath(n).base)).sort();
    if (conversations.length === 0) continue;
    if (CLAUDE_MARKERS.some((m) => bases.has(m))) {
      const plan: ExportPlan = { vendor: 'claude', conversations: conversations.slice(0, 1) };
      const projects = bases.get('projects.json');
      const memories = bases.get('memories.json');
      if (projects) plan.projects = projects;
      if (memories) plan.memories = memories;
      return plan;
    }
    const vendor = CHATGPT_MARKERS.some((m) => bases.has(m)) ? 'chatgpt' : 'unknown';
    return { vendor, conversations };
  }

  const gemini = files.filter((name) => {
    const { segments } = splitPath(name);
    return segments.slice(0, -1).some((s) => /gemini/i.test(s)) && /\.(json|html?)$/i.test(name);
  });
  const json = gemini.filter((n) => /\.json$/i.test(n));
  const chosen = (json.length > 0 ? json : gemini).sort().slice(0, MAX_GEMINI_FILES);
  return chosen.length > 0 ? { vendor: 'gemini', files: chosen } : null;
}

function plannedFiles(plan: ExportPlan): string[] {
  if (plan.vendor === 'gemini') return plan.files;
  return [...plan.conversations, ...(plan.projects ? [plan.projects] : []), ...(plan.memories ? [plan.memories] : [])];
}

function parseJson(file: string, text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return err({ kind: 'malformed_json', file });
  }
}

class Progress {
  readonly event: ImportProgressEvent = { stage: 'reading', filesParsed: 0, conversations: 0, chunks: 0, bytesInflated: 0 };
  constructor(private readonly listener: ImportOptions['onProgress']) {}
  emit(patch: Partial<ImportProgressEvent>): void {
    Object.assign(this.event, patch);
    this.listener?.({ ...this.event });
  }
}

interface Pipeline {
  nowMs: number;
  tick: () => Promise<boolean>;
  progress: Progress;
}

function sniffVendor(first: unknown): 'chatgpt' | 'claude' | null {
  if (!isRecord(first)) return null;
  if (Object.hasOwn(first, 'mapping')) return 'chatgpt';
  if (Object.hasOwn(first, 'chat_messages')) return 'claude';
  return null;
}

async function normalize(
  plan: ExportPlan,
  files: ReadonlyMap<string, string>,
  p: Pipeline,
): Promise<Result<{ vendor: ImportVendor; conversations: NormalizedConversation[]; skipped: number }>> {
  const conversations: NormalizedConversation[] = [];
  let skipped = 0;
  const parsed = (): void => p.progress.emit({ stage: 'parsing', filesParsed: p.progress.event.filesParsed + 1 });
  const add = async (conversation: NormalizedConversation | null): Promise<boolean> => {
    if (conversation) conversations.push(conversation);
    else skipped += 1;
    if (conversations.length % 100 === 0) p.progress.emit({ conversations: conversations.length });
    return p.tick();
  };

  if (plan.vendor === 'gemini') {
    for (const name of plan.files) {
      const text = files.get(name) ?? '';
      let found: NormalizedConversation[] | null;
      if (/\.json$/i.test(name)) {
        const json = parseJson(name, text);
        if (!json.ok) return json;
        found = parseGeminiJson(json.value);
        if (found === null) return err({ kind: 'invalid_shape', file: name, detail: 'expected an array of activity entries' });
      } else {
        found = parseGeminiHtml(text);
      }
      parsed();
      for (const c of found) if (await add(c)) return err({ kind: 'aborted' });
    }
    return ok({ vendor: 'gemini', conversations, skipped });
  }

  let vendor: 'chatgpt' | 'claude' | 'unknown' = plan.vendor;
  const profileTexts: string[] = [];
  let profileAt = Number.POSITIVE_INFINITY;
  for (const name of plan.conversations) {
    const json = parseJson(name, files.get(name) ?? '');
    if (!json.ok) return json;
    if (!Array.isArray(json.value)) return err({ kind: 'invalid_shape', file: name, detail: 'conversations must be an array' });
    if (vendor === 'unknown') {
      const sniffed = json.value.length === 0 ? 'chatgpt' : sniffVendor(json.value[0]);
      if (sniffed === null) return err({ kind: 'unrecognized_export' });
      vendor = sniffed;
    }
    for (const raw of json.value) {
      if (vendor === 'chatgpt') {
        const result = parseChatGptConversation(raw, p.nowMs);
        if (result.profileTexts.length > 0) {
          profileTexts.push(...result.profileTexts);
          profileAt = Math.min(profileAt, result.startedAt);
        }
        if (await add(result.conversation)) return err({ kind: 'aborted' });
      } else if (await add(parseClaudeConversation(raw, p.nowMs))) {
        return err({ kind: 'aborted' });
      }
    }
    parsed();
  }

  if (vendor === 'chatgpt') {
    const profile = chatGptProfileConversation(profileTexts, Number.isFinite(profileAt) ? profileAt : p.nowMs);
    if (profile) conversations.unshift(profile);
    return ok({ vendor, conversations, skipped });
  }
  // Optional Claude files: a broken projects or memories file should not sink the whole import.
  const optional: [string | undefined, (raw: unknown) => NormalizedConversation[]][] = [
    [plan.projects, (raw) => parseClaudeProjects(raw, p.nowMs)],
    [plan.memories, (raw) => parseClaudeMemories(raw, p.nowMs)],
  ];
  for (const [name, parse] of optional) {
    if (!name) continue;
    const json = parseJson(name, files.get(name) ?? '');
    if (!json.ok) {
      skipped += 1;
      continue;
    }
    conversations.unshift(...parse(json.value));
    parsed();
  }
  return ok({ vendor: 'claude', conversations, skipped });
}

async function toResult(
  vendor: ImportVendor,
  conversations: NormalizedConversation[],
  skipped: number,
  p: Pipeline,
): Promise<Result<ImportResult>> {
  p.progress.emit({ stage: 'chunking' });
  const chunks: DistillChunk[] = [];
  const sources: ChunkSource[] = [];
  let userTurns = 0;
  let used = 0;
  for (const conversation of conversations) {
    // A pasted "what do you know about me" answer is one dense fact per line, so it is chunked
    // small: Distill returns at most a handful of facts per chunk.
    const out = await chunkConversation(conversation, conversation.vendor === 'paste' ? PASTE_CHUNK_CHARS : MAX_CHUNK_CHARS);
    if (out === null) skipped += 1;
    else if (out.chunks.length > 0) {
      used += 1;
      userTurns += conversation.turns.length;
      chunks.push(...out.chunks);
      sources.push(...out.sources);
    }
    if (await p.tick()) return err({ kind: 'aborted' });
    if (used % 100 === 0) p.progress.emit({ chunks: chunks.length });
  }
  p.progress.emit({ stage: 'done', conversations: used, chunks: chunks.length });
  return ok({
    vendor,
    chunks,
    sources,
    stats: {
      files: p.progress.event.filesParsed,
      conversations: used,
      userTurns,
      chunks: chunks.length,
      skippedConversations: skipped,
    },
  });
}

function pipeline(opts: ImportOptions): Pipeline {
  return {
    nowMs: (opts.now ?? new Date()).getTime(),
    tick: createTicker(opts.sliceBudgetMs, opts.signal),
    progress: new Progress(opts.onProgress),
  };
}

async function run(plan: ExportPlan, files: ReadonlyMap<string, string>, p: Pipeline): Promise<Result<ImportResult>> {
  const normalized = await normalize(plan, files, p);
  if (!normalized.ok) return normalized;
  const { vendor, conversations, skipped } = normalized.value;
  return toResult(vendor, conversations, skipped, p);
}

export interface ZipImportOptions extends ImportOptions {
  limits?: Partial<ZipLimits>;
}

/**
 * Imports a vendor export ZIP entirely on device. Detects the vendor from file names, inflates
 * only the files it needs under streaming limits, and returns chunks plus the local side table.
 */
export async function importZip(bytes: Uint8Array, opts: ZipImportOptions = {}): Promise<Result<ImportResult>> {
  const limits: ZipLimits = { ...ZIP_LIMITS, ...opts.limits };
  const p = pipeline(opts);
  p.progress.emit({ stage: 'reading' });
  const entries = listZipEntries(bytes, limits);
  if (!entries.ok) return entries;
  const plan = planExport(entries.value.map((e) => e.name));
  if (!plan) return err({ kind: 'unrecognized_export' });

  p.progress.emit({ stage: 'inflating' });
  const budget = { totalInflated: 0 };
  const files = new Map<string, string>();
  for (const name of plannedFiles(plan)) {
    const entry = entries.value.find((e) => e.name === name);
    if (!entry) continue;
    const before = budget.totalInflated;
    const text = await inflateEntryText(
      bytes,
      entry,
      budget,
      { tick: p.tick, onBytes: (n) => p.progress.emit({ bytesInflated: before + n }) },
      limits,
    );
    if (!text.ok) return text;
    files.set(name, text.value);
  }
  return run(plan, files, p);
}

/** Imports loose files (for example a bare conversations.json dropped without its ZIP). */
export async function importFiles(files: readonly TextFile[], opts: ImportOptions = {}): Promise<Result<ImportResult>> {
  const plan = planExport(files.map((f) => f.name));
  if (!plan) return err({ kind: 'unrecognized_export' });
  const p = pipeline(opts);
  return run(plan, new Map(files.map((f) => [f.name, f.text])), p);
}

/** Roughly ten pasted fact lines per Distill chunk. */
export const PASTE_CHUNK_CHARS = 900;

/** Paste box: each candidate line becomes a user-sourced turn under vendor `paste`. */
export async function importPaste(text: string, opts: ImportOptions = {}): Promise<Result<ImportResult>> {
  if (text.length > MAX_PASTE_CHARS) return err({ kind: 'paste_too_large', limit: MAX_PASTE_CHARS, actual: text.length });
  const candidates = splitPasteCandidates(text);
  if (candidates.length === 0) return err({ kind: 'empty_input' });
  const p = pipeline(opts);
  const conversation: NormalizedConversation = {
    vendor: 'paste',
    id: `paste-${await hashShort(candidates.join('\n'))}`,
    title: 'Pasted from an assistant',
    url: null,
    turns: candidates.map((candidate) => ({ text: candidate, at: p.nowMs })),
  };
  p.progress.emit({ stage: 'parsing', filesParsed: 1, conversations: 1 });
  return toResult('paste', [conversation], 0, p);
}

