import { MemWal } from '@mysten-incubation/memwal';
import { FerryDb, dbNameForAccount, type FerryDbOptions } from './db.js';
import { MemoryEngine, type EngineOptions } from './engine.js';
import { RateGovernor, type GovernorConfig } from './governor.js';
import { LocalIndex } from './local-index.js';
import { RelayerTransport, type RelayerClient } from './transport.js';
import { systemClock, type Clock } from './types.js';

const ACCOUNT_ID = /^0x[0-9a-f]{64}$/;

export interface FerryMemoryConfig {
  /** 32-byte Ed25519 delegate seed. The SDK needs raw bytes for SEAL sessions (DECISIONS). */
  seed: Uint8Array;
  accountId: string;
  serverUrl: string;
  clock?: Clock;
  random?: () => number;
  governor?: RateGovernor;
  governorConfig?: Partial<GovernorConfig>;
  db?: FerryDb;
  dbOptions?: FerryDbOptions;
  /** Test seam. Production builds one `MemWal` from seed, accountId and serverUrl. */
  client?: RelayerClient;
  engine?: Omit<EngineOptions, 'clock' | 'random'>;
}

export function assertConfig(seed: Uint8Array, accountId: string, serverUrl: string): void {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new TypeError('seed must be 32 bytes');
  if (!ACCOUNT_ID.test(accountId)) throw new TypeError('accountId must be 0x followed by 64 lowercase hex characters');
  const url = new URL(serverUrl);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  // Signed requests carry a SEAL session; never send them in clear except to a local relayer.
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new TypeError('serverUrl must be https');
}

/**
 * Standard mode memory. Holds ONE `MemWal` for its whole life: each new instance builds a new
 * SEAL session, which the #1157 reporter suspected of triggering the 401 storm (RESEARCH 1.2).
 */
export class FerryMemory extends MemoryEngine {
  constructor(config: FerryMemoryConfig) {
    assertConfig(config.seed, config.accountId, config.serverUrl);
    const clock = config.clock ?? systemClock;
    const governor = config.governor ?? new RateGovernor(config.governorConfig, clock, config.random);
    const client =
      config.client ??
      MemWal.create({ key: config.seed, accountId: config.accountId, serverUrl: config.serverUrl, namespace: 'ferry-core' });
    const db = config.db ?? new FerryDb(dbNameForAccount(config.accountId), config.dbOptions);
    super(new RelayerTransport(client, governor), new LocalIndex(db), governor, {
      ...config.engine,
      clock,
      ...(config.random ? { random: config.random } : {}),
    });
  }
}
