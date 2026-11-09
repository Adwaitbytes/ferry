import { z } from 'zod';

/*
 * F9 encrypted backup of a raw vendor export, pure parts. The ZIP is wrapped in a small envelope
 * (so restore gets the original file name back), Seal encrypted on this device under the MemWal
 * `seal_approve` policy, and stored on Walrus through the upload relay (RESEARCH section 6).
 * Wallet and network steps live in `backup-chain.ts`, loaded only when the user starts one.
 */

/** Mainnet MemWal package (Seal policy) and registry, as in packages/memwal vault.ts. */
export const MEMWAL_PACKAGE_ID = '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5';
export const MEMWAL_REGISTRY_ID = '0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f';

/** The open mode mainnet key servers MemWal itself uses, 2 of 2 (RESEARCH 1.5). URLs read on chain. */
export const SEAL_KEY_SERVERS = [
  { objectId: '0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6', url: 'https://seal-mainnet-open.overclock.run' },
  { objectId: '0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10', url: 'https://open.key-server.mainnet.seal.mirai.cloud' },
] as const;
export const SEAL_THRESHOLD = 2;

/** Tatum Storage needs an API key Ferry does not have, so uploads use the public relay (DECISIONS). */
export const WALRUS_UPLOAD_RELAY = 'https://upload-relay.mainnet.walrus.space';
/** Highest tip the relay may take, in MIST. The live tip is 40 MIST per encoded KiB. */
export const MAX_RELAY_TIP_MIST = 1_000_000;
/** Mainnet epochs are 14 days, so 26 epochs is about one year of storage. */
export const BACKUP_EPOCHS = 26;
export const EPOCH_MS = 14 * 86_400_000;

/** Seal id prefix. Any prefix passes `seal_approve`; it only keeps backup keys apart from memories. */
export const BACKUP_NAMESPACE = 'ferry-backup';
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

const MAGIC = 'FERRYBK1';
const MAX_HEADER_BYTES = 4096;

const SUI_ADDRESS = /^0x[0-9a-f]{1,64}$/;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * The Seal identity for a backup: hex(utf8(namespace)) || owner (32 bytes) || u64 little endian
 * `access_counter_version`. This is the layout `memwal::account::seal_approve` checks, the same
 * one the MemWal SDK writes for manual memories, so the owner and any delegate can decrypt it.
 */
export function backupSealId(owner: string, accessCounterVersion: bigint): string {
  const lower = owner.toLowerCase();
  if (!SUI_ADDRESS.test(lower)) throw new TypeError('owner must be a Sui address');
  if (accessCounterVersion < 0n || accessCounterVersion > 0xffff_ffff_ffff_ffffn) throw new RangeError('counter must be a u64');
  const ownerHex = lower.slice(2).padStart(64, '0');
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, accessCounterVersion, true);
  return `${toHex(new TextEncoder().encode(BACKUP_NAMESPACE))}${ownerHex}${toHex(counter)}`;
}

export const BackupHeader = z.object({
  v: z.literal(1),
  name: z.string().min(1).max(200),
  size: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type BackupHeader = z.infer<typeof BackupHeader>;

/** Envelope: "FERRYBK1", u32 big endian header length, header JSON, then the original bytes. */
export function packBackup(header: Omit<BackupHeader, 'v' | 'size'>, bytes: Uint8Array): Uint8Array {
  const full = BackupHeader.parse({ v: 1, size: bytes.length, ...header });
  const json = new TextEncoder().encode(JSON.stringify(full));
  if (json.length > MAX_HEADER_BYTES) throw new RangeError('backup header too large');
  const out = new Uint8Array(MAGIC.length + 4 + json.length + bytes.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(MAGIC.length, json.length, false);
  out.set(json, MAGIC.length + 4);
  out.set(bytes, MAGIC.length + 4 + json.length);
  return out;
}

export class BackupFormatError extends Error {
  override readonly name = 'BackupFormatError';
}

export function unpackBackup(envelope: Uint8Array): { header: BackupHeader; bytes: Uint8Array } {
  const magic = new TextDecoder().decode(envelope.subarray(0, MAGIC.length));
  if (magic !== MAGIC || envelope.length < MAGIC.length + 4) throw new BackupFormatError('This is not a Ferry backup.');
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const length = view.getUint32(MAGIC.length, false);
  const start = MAGIC.length + 4;
  if (length === 0 || length > MAX_HEADER_BYTES || start + length > envelope.length) throw new BackupFormatError('The backup header is damaged.');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(envelope.subarray(start, start + length)));
  } catch {
    throw new BackupFormatError('The backup header is damaged.');
  }
  const header = BackupHeader.safeParse(raw);
  if (!header.success) throw new BackupFormatError('The backup header is damaged.');
  const bytes = envelope.subarray(start + length);
  if (bytes.length !== header.data.size) throw new BackupFormatError('The backup is shorter or longer than it says.');
  return { header: header.data, bytes };
}

/** Rejects anything that is not plausibly a vendor export ZIP before any work or wallet prompt. */
export function checkExportFile(file: { name: string; size: number }, head: Uint8Array): string | null {
  if (!/\.zip$/i.test(file.name)) return 'Choose the export ZIP your AI app sent you.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BACKUP_BYTES) return `That file is ${formatBytes(file.size)}. Backups are limited to ${formatBytes(MAX_BACKUP_BYTES)}.`;
  const zip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05) && (head[3] === 0x04 || head[3] === 0x06);
  if (!zip) return 'That file does not look like a ZIP archive.';
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Approximate calendar date an end epoch maps to, from the current epoch and the 14 day length. */
export function epochToDate(endEpoch: number, currentEpoch: number, now: number): Date {
  return new Date(now + Math.max(0, endEpoch - currentEpoch) * EPOCH_MS);
}

/** What the page remembers about a backup. Lives in this browser only; the blob is on Walrus. */
export const BackupRecord = z.object({
  blobId: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  blobObjectId: z.string().regex(SUI_ADDRESS),
  owner: z.string().regex(SUI_ADDRESS),
  accountId: z.string().regex(SUI_ADDRESS),
  sealId: z.string().regex(/^[0-9a-f]+$/).max(400),
  fileName: z.string().min(1).max(200),
  size: z.number().int().nonnegative(),
  encryptedSize: z.number().int().nonnegative(),
  endEpoch: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type BackupRecord = z.infer<typeof BackupRecord>;

export const BACKUPS_STORAGE_KEY = 'ferry.backups.v1';
const MAX_RECORDS = 20;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Unreadable or missing storage reads as no backups; the blobs themselves stay in the wallet. */
export function readBackups(store: KeyValueStore | null): BackupRecord[] {
  if (store === null) return [];
  let raw: string | null;
  try {
    raw = store.getItem(BACKUPS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = z.array(z.unknown()).safeParse(parsed);
  if (!list.success) return [];
  return list.data.flatMap((r) => {
    const ok = BackupRecord.safeParse(r);
    return ok.success ? [ok.data] : [];
  });
}

/** Newest first, de-duplicated by blob id. Returns false when the browser refuses to store it. */
export function saveBackup(store: KeyValueStore | null, record: BackupRecord): boolean {
  if (store === null) return false;
  const next = [BackupRecord.parse(record), ...readBackups(store).filter((r) => r.blobId !== record.blobId)].slice(0, MAX_RECORDS);
  try {
    store.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** A restored file name is shown and used for a download, so strip anything path or control like. */
export function safeFileName(name: string): string {
  const cleaned = Array.from(name.split(/[\\/]/).pop() ?? '')
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  return cleaned.length === 0 ? 'ferry-backup.zip' : cleaned.slice(0, 200);
}
