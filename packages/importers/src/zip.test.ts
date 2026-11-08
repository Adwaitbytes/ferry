import { describe, expect, it } from 'vitest';
import { centralRecordOffset, zip64Of, zipOf } from './test-helpers.js';
import { ZIP_LIMITS, inflateEntryText, isUnsafeEntryName, listZipEntries, type ZipEntry } from './zip.js';

const never = { tick: () => Promise.resolve(false) };

async function inflateAll(bytes: Uint8Array, limits = ZIP_LIMITS) {
  const listed = listZipEntries(bytes, limits);
  if (!listed.ok) return listed;
  const budget = { totalInflated: 0 };
  const out: string[] = [];
  for (const entry of listed.value) {
    const text = await inflateEntryText(bytes, entry, budget, never, limits);
    if (!text.ok) return text;
    out.push(text.value);
  }
  return { ok: true as const, value: out };
}

describe('listZipEntries', () => {
  it('lists deflated and stored entries and inflates them', async () => {
    const result = await inflateAll(zipOf({ 'a.json': '{"a":1}', 'dir/b.txt': 'hello' }));
    expect(result).toEqual({ ok: true, value: ['{"a":1}', 'hello'] });
    const stored = await inflateAll(zipOf({ 'a.txt': 'stored', 'empty.txt': '' }, 0));
    expect(stored).toEqual({ ok: true, value: ['stored', ''] });
  });

  it('reads zip64 records', async () => {
    expect(await inflateAll(zip64Of('conversations.json', '[]'))).toEqual({ ok: true, value: ['[]'] });
  });

  it('rejects input that is not a zip', () => {
    expect(listZipEntries(new Uint8Array(10))).toEqual({ ok: false, error: { kind: 'not_a_zip' } });
    expect(listZipEntries(new TextEncoder().encode('x'.repeat(100)))).toEqual({ ok: false, error: { kind: 'not_a_zip' } });
  });

  it('rejects archives over the compressed cap before reading anything', () => {
    const result = listZipEntries(new Uint8Array(100), { ...ZIP_LIMITS, maxCompressedBytes: 50 });
    expect(result).toEqual({ ok: false, error: { kind: 'archive_too_large', limit: 50, actual: 100 } });
  });

  it('reports a corrupt central directory', () => {
    const bytes = zipOf({ 'a.txt': 'x' });
    const broken = bytes.slice();
    broken[centralRecordOffset(bytes, 'a.txt')] = 0;
    expect(listZipEntries(broken)).toMatchObject({ ok: false, error: { kind: 'corrupt_zip' } });
  });

  it('reports a broken zip64 locator', () => {
    const bytes = zip64Of('a.json', '[]');
    const broken = bytes.slice();
    broken[bytes.length - 22 - 20] = 0;
    expect(listZipEntries(broken)).toMatchObject({ ok: false, error: { kind: 'corrupt_zip', detail: 'missing zip64 locator' } });
    const badRecord = bytes.slice();
    badRecord[bytes.length - 22 - 20 - 56] = 0;
    expect(listZipEntries(badRecord)).toMatchObject({ ok: false, error: { kind: 'corrupt_zip', detail: 'bad zip64 record' } });
  });
});

describe('red team: archive structure', () => {
  it.each(['../../etc/passwd', '/etc/passwd', 'a/../../b.json', 'C:\\x.json', 'a\\b.json', 'c:/x', 'a\0b'])(
    'rejects unsafe entry name %s',
    (name) => {
      const result = listZipEntries(zipOf({ [name]: 'x', 'conversations.json': '[]' }));
      expect(result).toMatchObject({ ok: false, error: { kind: 'unsafe_entry_name' } });
    },
  );

  it('accepts ordinary names', () => {
    expect(isUnsafeEntryName('Takeout/My Activity/Gemini Apps/MyActivity.json')).toBe(false);
    expect(isUnsafeEntryName('..hidden/file')).toBe(false);
    expect(isUnsafeEntryName('')).toBe(true);
  });

  it('rejects more than 20,000 entries', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= ZIP_LIMITS.maxEntries; i += 1) files[`f${i}`] = '';
    expect(listZipEntries(zipOf(files, 0))).toEqual({ ok: false, error: { kind: 'too_many_entries', limit: 20_000 } });
  });

  it('aborts a zip bomb on the inflate ratio, judged on produced bytes', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024);
    const result = await inflateAll(zipOf({ 'conversations.json': zeros }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'zip_bomb', name: 'conversations.json' } });
    if (!result.ok && result.error.kind === 'zip_bomb') expect(result.error.ratio).toBeGreaterThan(200);
  });

  it('lets small highly compressible files through the ratio grace window', async () => {
    const result = await inflateAll(zipOf({ 'a.json': ' '.repeat(500_000) }));
    expect(result.ok).toBe(true);
  });

  it('enforces the per-entry and total inflated caps while streaming', async () => {
    const text = 'abcdefghij'.repeat(1000);
    const bytes = zipOf({ 'a.txt': text, 'b.txt': text });
    expect(await inflateAll(bytes, { ...ZIP_LIMITS, maxEntryInflatedBytes: 5000 })).toMatchObject({
      ok: false,
      error: { kind: 'entry_too_large', name: 'a.txt', limit: 5000 },
    });
    expect(await inflateAll(bytes, { ...ZIP_LIMITS, maxTotalInflatedBytes: 15_000 })).toEqual({
      ok: false,
      error: { kind: 'total_too_large', limit: 15_000 },
    });
  });

  it('does not trust the declared uncompressed size', async () => {
    const bytes = zipOf({ 'a.txt': 'x'.repeat(10_000) });
    const lying = bytes.slice();
    const view = new DataView(lying.buffer);
    view.setUint32(centralRecordOffset(bytes, 'a.txt') + 24, 1, true);
    expect(await inflateAll(lying, { ...ZIP_LIMITS, maxEntryInflatedBytes: 100 })).toMatchObject({
      ok: false,
      error: { kind: 'entry_too_large' },
    });
  });

  it('refuses encrypted entries and unknown compression methods', async () => {
    const bytes = zipOf({ 'a.txt': 'x' });
    const at = centralRecordOffset(bytes, 'a.txt');
    const encrypted = bytes.slice();
    encrypted[at + 8] = (encrypted[at + 8] ?? 0) | 1;
    expect(await inflateAll(encrypted)).toEqual({ ok: false, error: { kind: 'unsupported_entry', name: 'a.txt', reason: 'encrypted' } });
    const lzma = bytes.slice();
    lzma[at + 10] = 14;
    expect(await inflateAll(lzma)).toEqual({ ok: false, error: { kind: 'unsupported_entry', name: 'a.txt', reason: 'compression_method' } });
  });

  it('reports bad local headers, out-of-range data and corrupt deflate streams', async () => {
    const bytes = zipOf({ 'a.txt': 'some text that deflates '.repeat(50) });
    const listed = listZipEntries(bytes);
    if (!listed.ok) throw new Error('setup');
    const entry = listed.value[0] as ZipEntry;
    const budget = () => ({ totalInflated: 0 });
    expect(await inflateEntryText(bytes, { ...entry, localHeaderOffset: 5 }, budget(), never)).toMatchObject({
      error: { kind: 'corrupt_zip', detail: 'bad local header' },
    });
    expect(await inflateEntryText(bytes, { ...entry, compressedSize: bytes.length }, budget(), never)).toMatchObject({
      error: { kind: 'corrupt_zip', detail: 'entry data out of range' },
    });
    const garbled = bytes.slice();
    for (let i = 40; i < 60; i += 1) garbled[i] = 0xff;
    expect(await inflateEntryText(garbled, entry, budget(), never)).toMatchObject({ error: { kind: 'corrupt_zip' } });
  });

  it('stops when the tick reports an abort', async () => {
    const bytes = zipOf({ 'a.txt': 'x' });
    const listed = listZipEntries(bytes);
    if (!listed.ok) throw new Error('setup');
    const result = await inflateEntryText(bytes, listed.value[0] as ZipEntry, { totalInflated: 0 }, { tick: () => Promise.resolve(true) });
    expect(result).toEqual({ ok: false, error: { kind: 'aborted' } });
  });
});
