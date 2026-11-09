import { describe, expect, it } from 'vitest';
import {
  BACKUPS_STORAGE_KEY,
  BackupFormatError,
  EPOCH_MS,
  MAX_BACKUP_BYTES,
  backupSealId,
  checkExportFile,
  epochToDate,
  formatBytes,
  packBackup,
  readBackups,
  safeFileName,
  saveBackup,
  unpackBackup,
  type BackupRecord,
  type KeyValueStore,
} from './backup';

const OWNER = `0x${'53ec2bc0'.repeat(8)}`;

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const record = (blobId: string): BackupRecord => ({
  blobId,
  blobObjectId: `0x${'a'.repeat(64)}`,
  owner: OWNER,
  accountId: `0x${'b'.repeat(64)}`,
  sealId: backupSealId(OWNER, 0n),
  fileName: 'chatgpt-export.zip',
  size: 1234,
  encryptedSize: 1400,
  endEpoch: 40,
  createdAt: '2026-11-09T12:00:00.000Z',
});

describe('backupSealId', () => {
  it('matches the MemWal layout: namespace, owner bytes, u64 little endian counter', () => {
    const id = backupSealId(OWNER, 1n);
    expect(id.startsWith(Buffer.from('ferry-backup').toString('hex'))).toBe(true);
    expect(id.endsWith(`${'53ec2bc0'.repeat(8)}0100000000000000`)).toBe(true);
    expect(backupSealId(OWNER.toUpperCase().replace('0X', '0x'), 258n).endsWith('0201000000000000')).toBe(true);
  });

  it('pads short addresses and rejects bad input', () => {
    expect(backupSealId('0x2', 0n)).toContain(`${'0'.repeat(63)}2`);
    expect(() => backupSealId('not-an-address', 0n)).toThrow(/Sui address/);
    expect(() => backupSealId(OWNER, -1n)).toThrow(/u64/);
    expect(() => backupSealId(OWNER, 2n ** 64n)).toThrow(/u64/);
  });
});

describe('backup envelope', () => {
  it('round trips the file name and bytes', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]);
    const packed = packBackup({ name: 'export.zip', createdAt: '2026-11-09T12:00:00.000Z' }, bytes);
    const { header, bytes: out } = unpackBackup(packed);
    expect(header).toEqual({ v: 1, name: 'export.zip', size: 7, createdAt: '2026-11-09T12:00:00.000Z' });
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('refuses anything that is not an intact Ferry backup', () => {
    const packed = packBackup({ name: 'export.zip', createdAt: '2026-11-09T12:00:00.000Z' }, new Uint8Array(10));
    expect(() => unpackBackup(new Uint8Array([1, 2, 3]))).toThrow(BackupFormatError);
    expect(() => unpackBackup(packed.subarray(0, packed.length - 1))).toThrow(/shorter or longer/);
    const badLength = packed.slice();
    new DataView(badLength.buffer).setUint32(8, 0xffff, false);
    expect(() => unpackBackup(badLength)).toThrow(/damaged/);
    const badJson = packed.slice();
    badJson[13] = 0x7b;
    badJson[14] = 0x7b;
    expect(() => unpackBackup(badJson)).toThrow(/damaged/);
    expect(() => packBackup({ name: 'x'.repeat(201), createdAt: '2026-11-09T12:00:00.000Z' }, new Uint8Array(1))).toThrow();
  });
});

describe('checkExportFile', () => {
  const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  it('accepts a ZIP and explains every refusal', () => {
    expect(checkExportFile({ name: 'export.ZIP', size: 10 }, zipHead)).toBeNull();
    expect(checkExportFile({ name: 'export.json', size: 10 }, zipHead)).toMatch(/export ZIP/);
    expect(checkExportFile({ name: 'export.zip', size: 0 }, zipHead)).toMatch(/empty/);
    expect(checkExportFile({ name: 'export.zip', size: MAX_BACKUP_BYTES + 1 }, zipHead)).toMatch(/limited to 200.0 MB/);
    expect(checkExportFile({ name: 'export.zip', size: 10 }, new Uint8Array([1, 2, 3, 4]))).toMatch(/ZIP archive/);
  });
});

describe('formatting', () => {
  it('formats sizes and epoch dates', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(epochToDate(12, 10, 0).getTime()).toBe(2 * EPOCH_MS);
    expect(epochToDate(5, 10, 0).getTime()).toBe(0);
  });

  it('cleans restored file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\export.zip')).toBe('export.zip');
    expect(safeFileName('a\u0000b\u007f.zip')).toBe('ab.zip');
    expect(safeFileName('   ')).toBe('ferry-backup.zip');
  });
});

describe('backup records in this browser', () => {
  it('saves newest first without duplicates and survives junk', () => {
    const store = memoryStore();
    expect(readBackups(store)).toEqual([]);
    expect(saveBackup(store, record('blobAAAAAAAAAAAAAAAA'))).toBe(true);
    expect(saveBackup(store, record('blobBBBBBBBBBBBBBBBB'))).toBe(true);
    expect(saveBackup(store, record('blobAAAAAAAAAAAAAAAA'))).toBe(true);
    expect(readBackups(store).map((r) => r.blobId)).toEqual(['blobAAAAAAAAAAAAAAAA', 'blobBBBBBBBBBBBBBBBB']);

    store.data.set(BACKUPS_STORAGE_KEY, JSON.stringify([{ blobId: 'x' }, record('blobCCCCCCCCCCCCCCCC')]));
    expect(readBackups(store).map((r) => r.blobId)).toEqual(['blobCCCCCCCCCCCCCCCC']);
    store.data.set(BACKUPS_STORAGE_KEY, '{not json');
    expect(readBackups(store)).toEqual([]);
    store.data.set(BACKUPS_STORAGE_KEY, '{"a":1}');
    expect(readBackups(store)).toEqual([]);
  });

  it('treats blocked storage as empty and reports a failed save', () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readBackups(blocked)).toEqual([]);
    expect(readBackups(null)).toEqual([]);
    expect(saveBackup(blocked, record('blobAAAAAAAAAAAAAAAA'))).toBe(false);
    expect(saveBackup(null, record('blobAAAAAAAAAAAAAAAA'))).toBe(false);
  });
});
