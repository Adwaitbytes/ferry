import { describe, expect, it } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { checkTransactionAllowlist, relaySignedTransaction } from './allowlist.js';
import { MEMWAL_PACKAGE_ID, MEMWAL_REGISTRY_ID } from './constants.js';
import { TatumSui } from './rpc.js';
import { fakeClock, fakeRpc } from './fixtures.testutil.js';

const SENDER = `0x${'bb'.repeat(32)}`;
const ACCOUNT_ID = '0x212ffaa5009725d12f70e2699e5163a1f93f4d5574c2c9c2b87a2b243493d56e';
const DIGEST = '9Xq4Ttp6bVg3Jm5r2kWc8zLhN1sQe7YdFaB3uR6vPZmK';

/** Fully resolved transaction so it can be built offline, as a wallet-signed payload would be. */
async function build(compose: (tx: Transaction) => void): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.setSender(SENDER);
  tx.setGasPrice(1000);
  tx.setGasBudget(10_000_000);
  tx.setGasPayment([{ objectId: `0x${'11'.repeat(32)}`, version: '1', digest: DIGEST }]);
  compose(tx);
  return tx.build();
}

const shared = (tx: Transaction, objectId: string) => tx.sharedObjectRef({ objectId, initialSharedVersion: '1', mutable: true });

describe('X-CHP-1 transaction allowlist', () => {
  it('accepts MemWal account calls', async () => {
    const bytes = await build((tx) => {
      tx.moveCall({
        target: `${MEMWAL_PACKAGE_ID}::account::remove_delegate_key`,
        arguments: [shared(tx, ACCOUNT_ID), shared(tx, MEMWAL_REGISTRY_ID), tx.pure.vector('u8', new Array(32).fill(1))],
      });
    });
    expect(checkTransactionAllowlist(bytes)).toEqual({ ok: true, calls: [`${MEMWAL_PACKAGE_ID}::account::remove_delegate_key`] });
  });

  it('accepts plain coin commands and framework transfers', async () => {
    const bytes = await build((tx) => {
      const coin = tx.splitCoins(tx.gas, [1]);
      tx.transferObjects([coin], SENDER);
    });
    expect(checkTransactionAllowlist(bytes)).toEqual({ ok: true, calls: [] });
  });

  it('rejects calls into any other package', async () => {
    const bytes = await build((tx) => {
      tx.moveCall({ target: `0x${'de'.repeat(32)}::drain::all`, arguments: [] });
    });
    expect(checkTransactionAllowlist(bytes)).toEqual({ ok: false, reason: 'CALL_NOT_ALLOWED', detail: `0x${'de'.repeat(32)}::drain::all` });
  });

  it('rejects publish and malformed bytes', async () => {
    const bytes = await build((tx) => {
      tx.publish({ modules: [[1, 2, 3]], dependencies: ['0x1', '0x2'] });
    });
    expect(checkTransactionAllowlist(bytes)).toMatchObject({ ok: false, reason: 'COMMAND_NOT_ALLOWED', detail: 'Publish' });
    expect(checkTransactionAllowlist(new Uint8Array([9, 9, 9]))).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });

  it('relays only after the allowlist and a successful simulation', async () => {
    const { rpc, mocks } = fakeRpc();
    const sui = new TatumSui({ rpc, clock: fakeClock(), ratePerSec: 1000 });
    const good = await build((tx) => {
      tx.moveCall({ target: `${MEMWAL_PACKAGE_ID}::account::create_account`, arguments: [shared(tx, MEMWAL_REGISTRY_ID), tx.object.clock()] });
    });
    const bad = await build((tx) => {
      tx.moveCall({ target: `0x${'de'.repeat(32)}::drain::all`, arguments: [] });
    });

    expect(await relaySignedTransaction(sui, bad, ['sig'])).toEqual({ ok: false, reason: 'CALL_NOT_ALLOWED' });
    expect(mocks.simulateTransaction).not.toHaveBeenCalled();

    mocks.simulateTransaction.mockResolvedValueOnce({ $kind: 'FailedTransaction' });
    expect(await relaySignedTransaction(sui, good, ['sig'])).toEqual({ ok: false, reason: 'SIMULATION_FAILED' });
    expect(mocks.executeTransaction).not.toHaveBeenCalled();

    mocks.simulateTransaction.mockResolvedValue({ $kind: 'Transaction' });
    mocks.executeTransaction.mockResolvedValueOnce({ $kind: 'FailedTransaction' });
    expect(await relaySignedTransaction(sui, good, ['sig'])).toEqual({ ok: false, reason: 'EXECUTION_FAILED' });

    mocks.executeTransaction.mockResolvedValueOnce({ $kind: 'Transaction', Transaction: { digest: DIGEST } });
    expect(await relaySignedTransaction(sui, good, ['sig'])).toEqual({ ok: true, digest: DIGEST });
  });
});
