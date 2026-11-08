import { Inflate } from 'fflate';
import type { ImportError, Result } from './types.js';
import { err, ok } from './types.js';

/** Threat model section 13 (X-IMP) plus the importer brief; the stricter number wins. */
export const ZIP_LIMITS = {
  maxCompressedBytes: 512 * 1024 * 1024,
  maxEntryInflatedBytes: 1024 * 1024 * 1024,
  maxTotalInflatedBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 20_000,
  maxRatio: 200,
  /** Ratio is judged only after this much output, so tiny highly-compressible files pass. */
  ratioGraceBytes: 1024 * 1024,
} as const;

export type ZipLimits = { readonly [K in keyof typeof ZIP_LIMITS]: number };

export interface ZipEntry {
  name: string;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
/** Compressed bytes fed to the inflater per step: bounds output per step to roughly 16 MB. */
const INFLATE_STEP = 16 * 1024;

const decoder = new TextDecoder('utf-8');

class Reader {
  constructor(private readonly bytes: Uint8Array) {}
  get length(): number {
    return this.bytes.length;
  }
  u16(at: number): number {
    return (this.bytes[at] ?? 0) | ((this.bytes[at + 1] ?? 0) << 8);
  }
  u32(at: number): number {
    return (this.u16(at) + this.u16(at + 2) * 0x10000) >>> 0;
  }
  /** Values beyond 2^53 cannot be valid offsets into a 512 MB archive; Infinity fails every bound check. */
  u64(at: number): number {
    const high = this.u32(at + 4);
    return high > 0x1fffff ? Number.POSITIVE_INFINITY : high * 0x100000000 + this.u32(at);
  }
  slice(start: number, end: number): Uint8Array {
    return this.bytes.subarray(start, end);
  }
}

/**
 * True for names that could escape an extraction directory. We never write to disk, but a vendor
 * export never contains such names, so their presence marks a crafted archive.
 */
export function isUnsafeEntryName(name: string): boolean {
  if (name.length === 0 || name.includes('\0') || name.includes('\\')) return true;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
  return name.split('/').some((segment) => segment === '..');
}

function findEocd(r: Reader): number {
  const min = Math.max(0, r.length - 22 - U16_MAX);
  for (let at = r.length - 22; at >= min; at -= 1) {
    if (r.u32(at) === SIG_EOCD) return at;
  }
  return -1;
}

interface Directory {
  count: number;
  offset: number;
}

function readDirectory(r: Reader, eocd: number): Result<Directory> {
  let count = r.u16(eocd + 10);
  let offset = r.u32(eocd + 16);
  if (count === U16_MAX || offset === U32_MAX) {
    const locator = eocd - 20;
    if (locator < 0 || r.u32(locator) !== SIG_ZIP64_LOCATOR) return err({ kind: 'corrupt_zip', detail: 'missing zip64 locator' });
    const record = r.u64(locator + 8);
    if (!(record + 56 <= r.length) || r.u32(record) !== SIG_ZIP64_EOCD) return err({ kind: 'corrupt_zip', detail: 'bad zip64 record' });
    count = r.u64(record + 32);
    offset = r.u64(record + 48);
  }
  return ok({ count, offset });
}

/** Zip64 extended information extra field (0x0001) overrides the 32-bit fields that are saturated. */
function applyZip64Extra(
  r: Reader,
  extraStart: number,
  extraEnd: number,
  fields: { uncompressed: number; compressed: number; offset: number },
): void {
  let at = extraStart;
  while (at + 4 <= extraEnd) {
    const id = r.u16(at);
    const size = r.u16(at + 2);
    if (id === 0x0001) {
      let cursor = at + 4;
      if (fields.uncompressed === U32_MAX && cursor + 8 <= at + 4 + size) {
        fields.uncompressed = r.u64(cursor);
        cursor += 8;
      }
      if (fields.compressed === U32_MAX && cursor + 8 <= at + 4 + size) {
        fields.compressed = r.u64(cursor);
        cursor += 8;
      }
      if (fields.offset === U32_MAX && cursor + 8 <= at + 4 + size) fields.offset = r.u64(cursor);
      return;
    }
    at += 4 + size;
  }
}

/**
 * Lists entries from the central directory. Only names and compressed extents are trusted from it;
 * declared uncompressed sizes are ignored and limits are enforced while inflating.
 */
export function listZipEntries(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): Result<ZipEntry[]> {
  if (bytes.length > limits.maxCompressedBytes) {
    return err({ kind: 'archive_too_large', limit: limits.maxCompressedBytes, actual: bytes.length });
  }
  const r = new Reader(bytes);
  if (bytes.length < 22) return err({ kind: 'not_a_zip' });
  const eocd = findEocd(r);
  if (eocd === -1) return err({ kind: 'not_a_zip' });
  const directory = readDirectory(r, eocd);
  if (!directory.ok) return directory;
  const { count } = directory.value;
  if (count > limits.maxEntries) return err({ kind: 'too_many_entries', limit: limits.maxEntries });

  const entries: ZipEntry[] = [];
  let at = directory.value.offset;
  for (let i = 0; i < count; i += 1) {
    if (!(at + 46 <= r.length) || r.u32(at) !== SIG_CENTRAL) return err({ kind: 'corrupt_zip', detail: 'bad central directory' });
    const flags = r.u16(at + 8);
    const method = r.u16(at + 10);
    const nameLength = r.u16(at + 28);
    const extraLength = r.u16(at + 30);
    const commentLength = r.u16(at + 32);
    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    if (extraStart + extraLength > r.length) return err({ kind: 'corrupt_zip', detail: 'truncated central directory' });
    const name = decoder.decode(r.slice(nameStart, extraStart));
    const fields = { uncompressed: r.u32(at + 24), compressed: r.u32(at + 20), offset: r.u32(at + 42) };
    applyZip64Extra(r, extraStart, extraStart + extraLength, fields);
    if (isUnsafeEntryName(name)) return err({ kind: 'unsafe_entry_name', name: name.slice(0, 200) });
    entries.push({ name, method, encrypted: (flags & 1) === 1, compressedSize: fields.compressed, localHeaderOffset: fields.offset });
    at = extraStart + extraLength + commentLength;
  }
  return ok(entries);
}

/** Running total of inflated bytes across every entry of one archive. */
export interface InflateBudget {
  totalInflated: number;
}

export interface InflateHooks {
  /** Called between steps; resolving true aborts. */
  tick: () => Promise<boolean>;
  onBytes?: (inflatedSoFar: number) => void;
}

class InflateLimit extends Error {
  constructor(readonly error: ImportError) {
    super(error.kind);
  }
}

/**
 * Inflates one entry to text, streaming in small steps so the size, total and ratio limits apply
 * to bytes actually produced, never to sizes the archive claims.
 */
export async function inflateEntryText(
  bytes: Uint8Array,
  entry: ZipEntry,
  budget: InflateBudget,
  hooks: InflateHooks,
  limits: ZipLimits = ZIP_LIMITS,
): Promise<Result<string>> {
  if (entry.encrypted) return err({ kind: 'unsupported_entry', name: entry.name, reason: 'encrypted' });
  if (entry.method !== 0 && entry.method !== 8) return err({ kind: 'unsupported_entry', name: entry.name, reason: 'compression_method' });
  const r = new Reader(bytes);
  const local = entry.localHeaderOffset;
  if (!(local + 30 <= r.length) || r.u32(local) !== SIG_LOCAL) return err({ kind: 'corrupt_zip', detail: 'bad local header' });
  const dataStart = local + 30 + r.u16(local + 26) + r.u16(local + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (!(dataEnd <= r.length)) return err({ kind: 'corrupt_zip', detail: 'entry data out of range' });

  const textDecoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let produced = 0;
  let consumed = 0;
  const accept = (data: Uint8Array): void => {
    produced += data.length;
    budget.totalInflated += data.length;
    if (produced > limits.maxEntryInflatedBytes) {
      throw new InflateLimit({ kind: 'entry_too_large', name: entry.name, limit: limits.maxEntryInflatedBytes });
    }
    if (budget.totalInflated > limits.maxTotalInflatedBytes) {
      throw new InflateLimit({ kind: 'total_too_large', limit: limits.maxTotalInflatedBytes });
    }
    const ratio = produced / Math.max(consumed, 1);
    if (produced > limits.ratioGraceBytes && ratio > limits.maxRatio) {
      throw new InflateLimit({ kind: 'zip_bomb', name: entry.name, ratio: Math.round(ratio) });
    }
    parts.push(textDecoder.decode(data, { stream: true }));
  };

  try {
    const inflater = entry.method === 8 ? new Inflate((data) => accept(data)) : null;
    let pos = dataStart;
    do {
      const end = Math.min(pos + INFLATE_STEP, dataEnd);
      consumed += end - pos;
      const step = r.slice(pos, end);
      if (inflater) inflater.push(step, end === dataEnd);
      else accept(step);
      hooks.onBytes?.(produced);
      if (await hooks.tick()) return err({ kind: 'aborted' });
      pos = end;
    } while (pos < dataEnd);
    parts.push(textDecoder.decode());
    return ok(parts.join(''));
  } catch (cause) {
    if (cause instanceof InflateLimit) return err(cause.error);
    // V8 throws RangeError when a string would exceed its maximum length.
    if (cause instanceof RangeError) return err({ kind: 'entry_too_large', name: entry.name, limit: limits.maxEntryInflatedBytes });
    return err({ kind: 'corrupt_zip', detail: `inflate failed for ${entry.name.slice(0, 100)}` });
  }
}
