import { describe, expect, it } from 'vitest';
import { ObjectError } from '@mysten/sui/client';
import { TatumSui, ChainDataError, CACHE_TTL_MS } from './rpc.js';
import { CreditMeter } from './meter.js';
import { fakeClock, fakeRpc, fixtureObject } from './fixtures.testutil.js';
import { RateLimitedError } from './limiter.js';

const ACCOUNT_ID = '0x212ffaa5009725d12f70e2699e5163a1f93f4d5574c2c9c2b87a2b243493d56e';
const account = fixtureObject('account.json');

function setup(options: { ratePerSec?: number } = {}) {
  const clock = fakeClock();
  const { rpc, mocks } = fakeRpc({ [ACCOUNT_ID]: account });
  const sui = new TatumSui({ rpc, clock, ratePerSec: options.ratePerSec ?? 3, retry: { random: () => 0 } });
  return { sui, mocks, clock };
}

describe('TatumSui', () => {
  it('caches GetObject for 15 s and meters calls and hits', async () => {
    const { sui, mocks, clock } = setup();
    expect((await sui.getObject(ACCOUNT_ID))?.objectId).toBe(ACCOUNT_ID);
    await sui.getObject(ACCOUNT_ID.toUpperCase().replace('0X', '0x'));
    expect(mocks.getObjects).toHaveBeenCalledTimes(1);
    clock.advance(CACHE_TTL_MS.object);
    await sui.getObject(ACCOUNT_ID);
    expect(mocks.getObjects).toHaveBeenCalledTimes(2);
    const meter = sui.getMeter();
    expect(meter.methods['BatchGetObjects']).toMatchObject({ calls: 2, credits: 4 });
    expect(meter.methods['GetObject']).toMatchObject({ cacheHits: 1 });
    expect(sui.meter).toBeInstanceOf(CreditMeter);
  });

  it('maps not-found and deleted objects to null and rethrows other errors', async () => {
    const { sui, mocks } = setup();
    expect(await sui.getObjects([])).toEqual([]);
    mocks.getObjects.mockImplementationOnce(async ({ objectIds }) => ({
      objects: [new ObjectError('deleted', 'gone', { reason: 'deleted', objectId: objectIds[0] ?? '' })],
    }));
    expect(await sui.getObjects(['0x1'])).toEqual([null]);
    mocks.getObjects.mockImplementationOnce(async () => ({ objects: [new ObjectError('INTERNAL', 'bad', { reason: 'unknown' })] }));
    await expect(sui.getObjects(['0x1'])).rejects.toThrow('bad');
    await expect(sui.getObjects(['not an id'])).rejects.toThrow(TypeError);
  });

  it('paces upstream calls at 3 rps', async () => {
    const { sui, clock } = setup();
    await sui.getObjects(['0x1']);
    await sui.getObjects(['0x2']);
    await sui.getObjects(['0x3']);
    expect(clock.sleeps).toEqual([334, 333]);
  });

  it('retries UNAVAILABLE (gateway 429) and meters the retry', async () => {
    const { sui, mocks } = setup();
    mocks.getObjects.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Received HTTP status code 429'), { code: 'UNAVAILABLE' });
    });
    expect((await sui.getObjects([ACCOUNT_ID]))[0]?.objectId).toBe(ACCOUNT_ID);
    expect(sui.getMeter().methods['BatchGetObjects']).toMatchObject({ calls: 1, errors: 1, retries: 1 });
  });

  it('reads the Sui epoch with a 60 s cache', async () => {
    const { sui, mocks, clock } = setup();
    expect(await sui.getSuiEpoch()).toBe(1305n);
    expect(await sui.getSuiEpoch()).toBe(1305n);
    expect(mocks.getEpoch).toHaveBeenCalledTimes(1);
    expect(mocks.getEpoch).toHaveBeenCalledWith({});
    clock.advance(CACHE_TTL_MS.epoch);
    await sui.getSuiEpoch();
    expect(mocks.getEpoch).toHaveBeenCalledTimes(2);
  });

  it('fails clearly when GetEpoch returns no epoch', async () => {
    const { sui, mocks } = setup();
    mocks.getEpoch.mockImplementationOnce(async () => ({ response: { epoch: {} } }) as never);
    await expect(sui.getSuiEpoch()).rejects.toThrow(ChainDataError);
  });

  it('passes balance, history, simulate and execute through the paced path', async () => {
    const { sui, mocks } = setup();
    expect((await sui.getBalance('0x1', '0x2::sui::SUI')).balance).toBe('5');
    expect(mocks.getBalance).toHaveBeenCalledWith({ owner: `0x${'0'.repeat(63)}1`, coinType: '0x2::sui::SUI' });

    await sui.listTransactionsBySender('0x1', { limit: 500, before: 'cursor' });
    expect(mocks.listTransactions).toHaveBeenLastCalledWith({
      filter: { sender: `0x${'0'.repeat(63)}1` },
      order: 'descending',
      limit: 50,
      before: 'cursor',
      include: { balanceChanges: true },
    });
    await sui.listTransactionsBySender('0x1');
    expect(mocks.listTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20 }));

    mocks.simulateTransaction.mockResolvedValueOnce({ $kind: 'Transaction' });
    mocks.executeTransaction.mockResolvedValueOnce({ $kind: 'Transaction' });
    const bytes = new Uint8Array([1, 2, 3]);
    await sui.simulateTransaction(bytes);
    await sui.executeTransaction(bytes, ['sig']);
    expect(mocks.simulateTransaction).toHaveBeenCalledWith({ transaction: bytes, include: { balanceChanges: true, effects: true } });
    expect(mocks.executeTransaction).toHaveBeenCalledWith({
      transaction: bytes,
      signatures: ['sig'],
      include: { balanceChanges: true, effects: true },
    });
    const methods = Object.keys(sui.getMeter().methods);
    expect(methods).toEqual(expect.arrayContaining(['GetBalance', 'ListTransactions', 'SimulateTransaction', 'ExecuteTransaction']));
  });

  it('sheds load instead of queueing without bound', async () => {
    const clock = fakeClock(0, { advanceOnSleep: false });
    const { rpc } = fakeRpc();
    const sui = new TatumSui({ rpc, clock, ratePerSec: 1, maxQueueWaitMs: 1500 });
    await sui.getObjects(['0x1']);
    await sui.getObjects(['0x2']);
    await expect(sui.getObjects(['0x3'])).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('works with default options', async () => {
    const { rpc } = fakeRpc({ [ACCOUNT_ID]: account });
    const sui = new TatumSui({ rpc });
    expect((await sui.getObject(ACCOUNT_ID))?.version).toBe('1033038161');
  });
});
