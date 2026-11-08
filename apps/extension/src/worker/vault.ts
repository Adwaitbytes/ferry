import { z } from 'zod';
import { MESSAGES, WorkerFailure } from './errors';
import type { Clock, StorageArea, VaultCrypto } from './ports';

export type LockState = 'uninitialized' | 'locked' | 'open';

export const VAULT_KEY = 'ferry.vault';
export const SESSION_KEY = 'ferry.session';

const VaultRecord = z.object({
  v: z.literal(1),
  sealed: z.unknown(),
  publicKeyHex: z.string().regex(/^[0-9a-f]{64}$/),
  suiAddress: z.string().regex(/^0x[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
});
export type VaultRecord = z.infer<typeof VaultRecord>;

const SessionRecord = z.object({
  seedHex: z.string().regex(/^[0-9a-f]{64}$/),
  lastActivityAt: z.number().int().nonnegative(),
});

/** Passphrase guesses are slowed after this many failures, doubling each time. */
const FREE_ATTEMPTS = 5;
const BASE_PENALTY_MS = 30_000;
const MAX_PENALTY_MS = 15 * 60_000;
/** Activity timestamps are persisted at most this often; the in-memory value is always exact. */
const PERSIST_ACTIVITY_EVERY_MS = 15_000;

export interface VaultDeps {
  local: StorageArea;
  session: StorageArea;
  crypto: VaultCrypto;
  clock: Clock;
  autoLockMs(): Promise<number>;
  onOpen(seed: Uint8Array): Promise<void>;
  onLock(): void;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The lock state machine. The seed exists in clear only in this object and in
 * `chrome.storage.session` (TRUSTED_CONTEXTS, so content scripts cannot read it), and both are
 * cleared on lock. Expiry is checked on every privileged call, so a missed alarm or a suspended
 * worker can never leave Ferry open past the idle limit (THREAT_MODEL X-KEY-3).
 */
export class Vault {
  private seed: Uint8Array | null = null;
  private lastActivityAt = 0;
  private lastPersistedAt = 0;
  private failures = 0;
  private blockedUntil = 0;

  constructor(private readonly deps: VaultDeps) {}

  async record(): Promise<VaultRecord | null> {
    const parsed = VaultRecord.safeParse(await this.deps.local.get(VAULT_KEY));
    return parsed.success ? parsed.data : null;
  }

  async state(): Promise<LockState> {
    if ((await this.record()) === null) return 'uninitialized';
    await this.expireIfIdle();
    return this.seed === null ? 'locked' : 'open';
  }

  keyInMemory(): boolean {
    return this.seed !== null;
  }

  /** Called when the worker starts: picks the seed back up from session storage if still fresh. */
  async restore(): Promise<void> {
    if (this.seed !== null) return;
    const parsed = SessionRecord.safeParse(await this.deps.session.get(SESSION_KEY));
    if (!parsed.success) return;
    const idleFor = this.deps.clock.now() - parsed.data.lastActivityAt;
    if (idleFor > (await this.deps.autoLockMs()) || (await this.record()) === null) {
      await this.deps.session.remove(SESSION_KEY);
      return;
    }
    this.seed = fromHex(parsed.data.seedHex);
    this.lastActivityAt = parsed.data.lastActivityAt;
    this.lastPersistedAt = parsed.data.lastActivityAt;
    await this.deps.onOpen(this.seed);
  }

  /** First call creates the vault (new seed sealed under the passphrase); later calls open it. */
  async open(passphrase: string): Promise<void> {
    const now = this.deps.clock.now();
    if (now < this.blockedUntil) {
      throw new WorkerFailure(
        'locked',
        'Too many wrong passphrases. Wait a moment and try again.',
        this.blockedUntil - now,
      );
    }
    const existing = await this.record();
    let seed: Uint8Array;
    if (existing === null) {
      seed = this.deps.crypto.generateSeed();
      const sealed = await this.deps.crypto.sealSeed(seed, passphrase);
      const record: VaultRecord = {
        v: 1,
        sealed,
        publicKeyHex: (await this.deps.crypto.publicKeyHex(seed)).toLowerCase(),
        suiAddress: (await this.deps.crypto.suiAddress(seed)).toLowerCase(),
        createdAt: new Date(now).toISOString(),
      };
      await this.deps.local.set(VAULT_KEY, VaultRecord.parse(record));
    } else {
      try {
        seed = await this.deps.crypto.openSeed(existing.sealed, passphrase);
      } catch {
        this.failures += 1;
        if (this.failures >= FREE_ATTEMPTS) {
          const penalty = Math.min(
            MAX_PENALTY_MS,
            BASE_PENALTY_MS * 2 ** (this.failures - FREE_ATTEMPTS),
          );
          this.blockedUntil = now + penalty;
        }
        throw new WorkerFailure('locked', 'That passphrase did not open Ferry.');
      }
    }
    this.failures = 0;
    this.blockedUntil = 0;
    this.seed = seed;
    this.lastActivityAt = now;
    await this.persistSession(now);
    await this.deps.onOpen(seed);
  }

  async lock(): Promise<void> {
    if (this.seed !== null) this.seed.fill(0);
    this.seed = null;
    this.lastActivityAt = 0;
    this.lastPersistedAt = 0;
    await this.deps.session.remove(SESSION_KEY);
    this.deps.onLock();
  }

  /** Returns the seed for a privileged call, locking first if the idle limit has passed. */
  async requireSeed(): Promise<Uint8Array> {
    if (this.seed === null) await this.restore();
    await this.expireIfIdle();
    if (this.seed === null) {
      throw new WorkerFailure(
        'locked',
        (await this.record()) === null ? MESSAGES.noVault : MESSAGES.locked,
      );
    }
    await this.touch();
    return this.seed;
  }

  async touch(): Promise<void> {
    if (this.seed === null) return;
    const now = this.deps.clock.now();
    this.lastActivityAt = now;
    if (now - this.lastPersistedAt >= PERSIST_ACTIVITY_EVERY_MS) await this.persistSession(now);
  }

  /** Milliseconds until auto-lock, or null when locked. Drives the backup alarm. */
  async msUntilAutoLock(): Promise<number | null> {
    if (this.seed === null) return null;
    return Math.max(
      0,
      this.lastActivityAt + (await this.deps.autoLockMs()) - this.deps.clock.now(),
    );
  }

  private async expireIfIdle(): Promise<void> {
    if (this.seed === null) return;
    if (this.deps.clock.now() - this.lastActivityAt > (await this.deps.autoLockMs()))
      await this.lock();
  }

  private async persistSession(now: number): Promise<void> {
    if (this.seed === null) return;
    this.lastPersistedAt = now;
    await this.deps.session.set(SESSION_KEY, { seedHex: toHex(this.seed), lastActivityAt: now });
  }
}
