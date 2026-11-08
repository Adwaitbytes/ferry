import { DistillRequest } from '@ferry/core';
import { describe, expect, it } from 'vitest';
import { batchChunks } from './chunk.js';
import { importFiles, importPaste, importZip, planExport } from './import.js';
import { MAX_PASTE_CHARS } from './paste.js';
import { fixture, zipOf } from './test-helpers.js';
import type { ImportProgressEvent, ImportResult, Result } from './types.js';

const now = new Date('2026-11-09T12:00:00Z');

function value(result: Result<ImportResult>): ImportResult {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.kind}`);
  return result.value;
}

function expectValidChunks(result: ImportResult): void {
  for (const batch of batchChunks(result.chunks)) expect(DistillRequest.safeParse({ chunks: batch }).success).toBe(true);
  expect(result.sources.map((s) => s.chunkId)).toEqual(result.chunks.map((c) => c.chunkId));
}

const chatgptZip = () =>
  zipOf({
    'conversations.json': fixture('chatgpt/conversations.json'),
    'user.json': fixture('chatgpt/user.json'),
    'message_feedback.json': fixture('chatgpt/message_feedback.json'),
    'chat.html': '<html></html>',
    'file-SYNTHETIC-starter.png': new Uint8Array([137, 80, 78, 71]),
  });

describe('planExport', () => {
  it('recognizes each vendor from names only', () => {
    expect(planExport(['conversations.json', 'chat.html'])).toEqual({ vendor: 'chatgpt', conversations: ['conversations.json'] });
    expect(planExport(['export/conversations.json', 'export/users.json', 'export/projects.json', 'export/memories.json'])).toEqual({
      vendor: 'claude',
      conversations: ['export/conversations.json'],
      projects: 'export/projects.json',
      memories: 'export/memories.json',
    });
    expect(planExport(['conversations.json'])).toEqual({ vendor: 'unknown', conversations: ['conversations.json'] });
    expect(planExport(['conversations-001.json', 'conversations-000.json', 'user.json'])).toEqual({
      vendor: 'chatgpt',
      conversations: ['conversations-000.json', 'conversations-001.json'],
    });
    expect(planExport(['Takeout/My Activity/Gemini Apps/MyActivity.html', 'Takeout/My Activity/Gemini Apps/MyActivity.json'])).toEqual({
      vendor: 'gemini',
      files: ['Takeout/My Activity/Gemini Apps/MyActivity.json'],
    });
    expect(planExport(['Takeout/Meine Aktivitaten/Gemini-Apps/MeineAktivitaten.html'])).toMatchObject({ vendor: 'gemini' });
  });

  it('ignores deep, macOS metadata and unrelated files', () => {
    expect(planExport(['a/b/conversations.json', '__MACOSX/conversations.json', '._conversations.json', 'notes.txt'])).toBeNull();
    expect(planExport(['Takeout/YouTube/history.json'])).toBeNull();
  });
});

describe('importZip: ChatGPT', () => {
  it('imports the fixture export end to end', async () => {
    const events: ImportProgressEvent[] = [];
    const result = value(await importZip(chatgptZip(), { now, onProgress: (e) => events.push(e) }));
    expect(result.vendor).toBe('chatgpt');
    expect(result.stats).toMatchObject({ files: 1, conversations: 5, skippedConversations: 2 });
    expectValidChunks(result);
    const profile = result.sources.find((s) => s.conversationId === 'chatgpt-custom-instructions');
    expect(profile?.rawUserText).toContain('Keep answers short and use metric units.');
    expect(profile?.messageAt).toBe('2025-01-01T10:00:00.123Z');
    const trip = result.sources.find((s) => s.conversationTitle === 'SYNTHETIC: Weekend trip planning');
    expect(trip?.conversationUrl).toBe('https://chatgpt.com/c/6770a1b2-0000-4000-8000-000000000001');
    expect(events.map((e) => e.stage)).toEqual(expect.arrayContaining(['reading', 'inflating', 'parsing', 'chunking', 'done']));
    expect(events.at(-1)).toMatchObject({ stage: 'done', chunks: result.chunks.length });
  });

  it('sniffs the vendor when no marker files are present', async () => {
    const result = value(await importZip(zipOf({ 'conversations.json': fixture('chatgpt/conversations.json') }), { now }));
    expect(result.vendor).toBe('chatgpt');
    const claude = value(await importZip(zipOf({ 'conversations.json': fixture('claude/conversations.json') }), { now }));
    expect(claude.vendor).toBe('claude');
    expect(value(await importZip(zipOf({ 'conversations.json': '[]' }), { now })).chunks).toEqual([]);
  });

  it('returns typed errors for bad conversations files', async () => {
    const run = (text: string) => importZip(zipOf({ 'conversations.json': text, 'user.json': '{}' }), { now });
    expect(await run('{not json')).toEqual({ ok: false, error: { kind: 'malformed_json', file: 'conversations.json' } });
    expect(await run('{"conversations": []}')).toMatchObject({ ok: false, error: { kind: 'invalid_shape', file: 'conversations.json' } });
    expect(await importZip(zipOf({ 'conversations.json': '[{"foo":1}]' }))).toEqual({ ok: false, error: { kind: 'unrecognized_export' } });
    expect(await importZip(zipOf({ 'readme.txt': 'hi' }))).toEqual({ ok: false, error: { kind: 'unrecognized_export' } });
    expect(await importZip(new Uint8Array(4))).toEqual({ ok: false, error: { kind: 'not_a_zip' } });
  });

  it('applies limit overrides', async () => {
    const result = await importZip(chatgptZip(), { limits: { maxEntries: 2 } });
    expect(result).toEqual({ ok: false, error: { kind: 'too_many_entries', limit: 2 } });
  });

  it('RT-56 rejects a zip bomb disguised as conversations.json', async () => {
    const result = await importZip(zipOf({ 'conversations.json': new Uint8Array(8 * 1024 * 1024).fill(32) }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'zip_bomb' } });
  });

  it('RT-59 rejects path traversal anywhere in the archive', async () => {
    const result = await importZip(zipOf({ 'conversations.json': '[]', '../../etc/passwd': 'root:x:0:0' }));
    expect(result).toEqual({ ok: false, error: { kind: 'unsafe_entry_name', name: '../../etc/passwd' } });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await importZip(chatgptZip(), { signal: controller.signal })).toEqual({ ok: false, error: { kind: 'aborted' } });
    expect(await importFiles([{ name: 'conversations.json', text: fixture('claude/conversations.json') }], { signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
    expect(
      await importFiles([{ name: 'Gemini Apps/MyActivity.json', text: fixture('gemini/MyActivity.json') }], { signal: controller.signal }),
    ).toEqual({ ok: false, error: { kind: 'aborted' } });
    expect(await importPaste('I like tea a lot', { signal: controller.signal })).toEqual({ ok: false, error: { kind: 'aborted' } });
  });
});

describe('importZip: Claude', () => {
  it('imports conversations, projects and memories', async () => {
    const bytes = zipOf({
      'data-2025/conversations.json': fixture('claude/conversations.json'),
      'data-2025/projects.json': fixture('claude/projects.json'),
      'data-2025/memories.json': fixture('claude/memories.json'),
      'data-2025/users.json': fixture('claude/users.json'),
    });
    const result = value(await importZip(bytes, { now }));
    expect(result.vendor).toBe('claude');
    expectValidChunks(result);
    expect(result.stats.files).toBe(3);
    const ids = new Set(result.sources.map((s) => s.conversationId));
    expect(ids).toContain('claude-memory');
    expect(ids).toContain('9a8b7c6d-0000-4000-8000-000000000p02');
    expect(ids).toContain('0f1e2d3c-0000-4000-8000-00000000c001');
    expect(result.chunks.every((c) => !c.userText.includes('Internal reasoning'))).toBe(true);
  });

  it('skips broken optional files instead of failing', async () => {
    const bytes = zipOf({
      'conversations.json': fixture('claude/conversations.json'),
      'projects.json': '{broken',
      'users.json': '[]',
    });
    const result = value(await importZip(bytes, { now }));
    expect(result.stats.skippedConversations).toBeGreaterThan(0);
    expect(result.sources.some((s) => s.conversationId.startsWith('9a8b'))).toBe(false);
  });
});

describe('importZip: Gemini', () => {
  it('imports Takeout JSON', async () => {
    const bytes = zipOf({ 'Takeout/My Activity/Gemini Apps/MyActivity.json': fixture('gemini/MyActivity.json'), 'Takeout/archive_browser.html': '' });
    const result = value(await importZip(bytes, { now }));
    expect(result.vendor).toBe('gemini');
    expectValidChunks(result);
    expect(result.stats.conversations).toBe(4);
  });

  it('imports Takeout HTML', async () => {
    const bytes = zipOf({ 'Takeout/My Activity/Gemini Apps/MyActivity.html': fixture('gemini/MyActivity.html') });
    const result = value(await importZip(bytes, { now }));
    expect(result.chunks.map((c) => c.userText)).toHaveLength(3);
    expectValidChunks(result);
  });

  it('returns typed errors for bad Takeout JSON', async () => {
    const name = 'Takeout/My Activity/Gemini Apps/MyActivity.json';
    expect(await importFiles([{ name, text: '{' }])).toEqual({ ok: false, error: { kind: 'malformed_json', file: name } });
    expect(await importFiles([{ name, text: '{}' }])).toMatchObject({ ok: false, error: { kind: 'invalid_shape' } });
  });
});

describe('importFiles', () => {
  it('imports a bare conversations.json', async () => {
    const result = value(await importFiles([{ name: 'conversations.json', text: fixture('chatgpt/conversations.json') }], { now }));
    expect(result.vendor).toBe('chatgpt');
  });

  it('rejects unknown files', async () => {
    expect(await importFiles([{ name: 'x.txt', text: '' }])).toEqual({ ok: false, error: { kind: 'unrecognized_export' } });
  });
});

describe('importPaste', () => {
  it('turns candidate lines into paste chunks', async () => {
    const result = value(await importPaste('- I am a synthetic designer.\n- I like tea.\n', { now }));
    expect(result.vendor).toBe('paste');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.userText).toBe('I am a synthetic designer.\n\nI like tea.');
    expect(result.chunks[0]?.messageAt).toBe(now.toISOString());
    expect(result.sources[0]?.conversationUrl).toBeNull();
    expectValidChunks(result);
  });

  it('enforces the size cap and rejects empty input', async () => {
    expect(await importPaste('x'.repeat(MAX_PASTE_CHARS + 1))).toEqual({
      ok: false,
      error: { kind: 'paste_too_large', limit: MAX_PASTE_CHARS, actual: MAX_PASTE_CHARS + 1 },
    });
    expect(await importPaste('  \n -  \n')).toEqual({ ok: false, error: { kind: 'empty_input' } });
  });
});
