import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync, type Zippable } from 'fflate';

export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function fixture(path: string): string {
  // Test-only reader; paths are literals in this package's own tests.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(FIXTURES + path, 'utf8');
}

export function fixtureJson(path: string): unknown {
  return JSON.parse(fixture(path)) as unknown;
}

export function zipOf(files: Record<string, string | Uint8Array>, level: 0 | 6 = 6): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    zippable[name] = [typeof content === 'string' ? strToU8(content) : content, { level }];
  }
  return zipSync(zippable);
}

/** Offset of the central directory record for `name`. */
export function centralRecordOffset(bytes: Uint8Array, name: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const target = strToU8(name);
  for (let at = bytes.length - 46; at >= 0; at -= 1) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const length = view.getUint16(at + 28, true);
    if (length === target.length && bytes.subarray(at + 46, at + 46 + length).every((b, i) => b === target[i])) return at;
  }
  throw new Error(`no central record for ${name}`);
}

/**
 * Hand-built single-entry stored archive using zip64 records throughout, the way some streaming
 * writers emit them even for small files.
 */
export function zip64Of(name: string, content: string): Uint8Array {
  const nameBytes = strToU8(name);
  const data = strToU8(content);
  const parts: Uint8Array[] = [];
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const u64 = (v: number): Uint8Array => new Uint8Array([...u32(v), ...u32(0)]);
  const concat = (chunks: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  };

  const local = concat([u32(0x04034b50), u16(45), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
  parts.push(local);
  const extra = concat([u16(0x0001), u16(24), u64(data.length), u64(data.length), u64(0)]);
  const central = concat([
    u32(0x02014b50), u16(45), u16(45), u16(0), u16(0), u16(0), u16(0), u32(0),
    u32(0xffffffff), u32(0xffffffff), u16(nameBytes.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0), u32(0xffffffff),
    nameBytes, extra,
  ]);
  const centralOffset = local.length;
  parts.push(central);
  const zip64EocdOffset = centralOffset + central.length;
  parts.push(concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(1), u64(1), u64(central.length), u64(centralOffset)]));
  parts.push(concat([u32(0x07064b50), u32(0), u64(zip64EocdOffset), u32(1)]));
  parts.push(concat([u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(0)]));
  return concat(parts);
}
