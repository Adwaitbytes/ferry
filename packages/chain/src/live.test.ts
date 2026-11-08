import { describe, expect, it } from 'vitest';
import { createChainService } from './service.js';
import { createTatumGrpcClient } from './tatum.js';
import { MEMWAL_REGISTRY_ID } from './constants.js';

/**
 * Reads real Mainnet data through Tatum. Runs only when TATUM_API_KEY is set, so CI without the
 * secret stays green and offline.
 */
const apiKey = process.env['TATUM_API_KEY']?.trim();
const OWNER = '0x80086403f99ead1f34d51b8e55a53377bf5574bc2b35796b3153948060828b73';

describe.skipIf(!apiKey)('live Tatum Sui gRPC', () => {
  const key = apiKey ?? '';
  const chain = createChainService({ rpc: createTatumGrpcClient({ apiKey: key }), apiKey: key });

  it('reads the MemWal registry object', async () => {
    const registry = await chain.sui.getObject(MEMWAL_REGISTRY_ID);
    expect(registry?.type.endsWith('::account::AccountRegistry')).toBe(true);
  });

  it('resolves an owner to a MemWalAccount and reads epochs', async () => {
    const account = await chain.readAccountByOwner(OWNER);
    expect(account?.owner).toBe(OWNER);
    const epochs = await chain.currentEpoch();
    expect(epochs.sui.epoch).toBeGreaterThan(1000);
    expect(epochs.walrus.epoch).toBeGreaterThan(40);
    expect(chain.getMeter().totalCalls).toBeGreaterThan(0);
  });
});
