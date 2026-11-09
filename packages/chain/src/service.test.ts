import { afterEach, describe, expect, it } from 'vitest';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { createChainService, getChainService, resetChainService } from './service.js';
import { MissingApiKeyError, createTatumGrpcClient, tatumApiKeyFromEnv, tatumGrpcHost } from './tatum.js';
import { TATUM_SUI_GRPC_HOST, WALRUS_STAKING_OBJECT_ID } from './constants.js';
import { fakeRpc, fixtureObject } from './fixtures.testutil.js';
import { PriceFeed } from './price.js';

const KEY = ['k', 'e', 'y'].join('');
const ACCOUNT_ID = '0x212ffaa5009725d12f70e2699e5163a1f93f4d5574c2c9c2b87a2b243493d56e';
const OWNER = '0x80086403f99ead1f34d51b8e55a53377bf5574bc2b35796b3153948060828b73';
const ROW_ID = '0x0005632c7009535dccdadf19f2d3a618f4a575978c5e99ee085af895abfdea17';
const INNER_ID = '0x0ae6c892c35c5532c69c00e1655936ec11b701a3b04951dc63420386e37ef3cb';
const BLOB_OBJECT_ID = '0xa16ff652a8e38de8cab5d7393f449c6faeaf3f90467d2bab7c4bfafbb90436b0';

afterEach(() => resetChainService());

describe('Tatum configuration', () => {
  it('reads the key from env only and refuses an empty one', () => {
    expect(tatumApiKeyFromEnv({ TATUM_API_KEY: ` ${KEY} ` })).toBe(KEY);
    expect(() => tatumApiKeyFromEnv({})).toThrow(MissingApiKeyError);
    expect(() => tatumApiKeyFromEnv({ TATUM_API_KEY: '  ' })).toThrow('TATUM_API_KEY is not set');
  });

  it('derives the gRPC host from TATUM_SUI_GRPC_URL', () => {
    expect(tatumGrpcHost({})).toBe(TATUM_SUI_GRPC_HOST);
    expect(tatumGrpcHost({ TATUM_SUI_GRPC_URL: 'https://sui-mainnet-grpc.gateway.tatum.io' })).toBe(TATUM_SUI_GRPC_HOST);
    expect(tatumGrpcHost({ TATUM_SUI_GRPC_URL: 'example.com:8443' })).toBe('example.com:8443');
    expect(() => tatumGrpcHost({ TATUM_SUI_GRPC_URL: 'http://example.com' })).toThrow(/https/);
  });

  it('builds a SuiGrpcClient on the native gRPC transport', () => {
    expect(createTatumGrpcClient({ apiKey: KEY })).toBeInstanceOf(SuiGrpcClient);
  });
});

describe('ChainService', () => {
  it('wires readers, payments and prices to one meter', async () => {
    const { rpc } = fakeRpc({
      [ACCOUNT_ID]: fixtureObject('account.json'),
      [ROW_ID]: fixtureObject('registry-field.json'),
      [WALRUS_STAKING_OBJECT_ID]: fixtureObject('walrus-staking.json'),
      [INNER_ID]: fixtureObject('walrus-staking-inner.json'),
      [BLOB_OBJECT_ID]: fixtureObject('blob.json'),
    });
    const prices = new PriceFeed({
      apiKey: KEY,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ value: '1', basePair: 'USD', timestamp: 1 }) }),
    });
    const chain = createChainService({ rpc, apiKey: KEY, prices });
    expect((await chain.readAccount(ACCOUNT_ID))?.owner).toBe(OWNER);
    expect(await chain.findAccountByOwner(OWNER)).toBe(ACCOUNT_ID);
    expect((await chain.readAccountByOwner(OWNER))?.accountId).toBe(ACCOUNT_ID);
    expect((await chain.readBlob(BLOB_OBJECT_ID))?.endEpoch).toBe(58);
    expect((await chain.currentEpoch()).walrus.epoch).toBe(43);
    expect((await chain.getUsdPrice('USDC')).usd).toBe('1');
    expect(await chain.verifyUsdcPayment({ digest: 'x', recipient: OWNER, minAmountMicros: 1n, notBeforeMs: 0, notAfterMs: 1 })).toMatchObject({
      reason: 'NOT_FOUND',
    });
    expect(await chain.relaySignedTransaction(new Uint8Array([1]), [])).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(chain.getMeter().totalCalls).toBeGreaterThan(0);
    expect(createChainService({ rpc, apiKey: KEY }).prices).toBeInstanceOf(PriceFeed);
  });

  it('getChainService is a lazy singleton; without a key it reads on the anonymous plan but refuses prices', async () => {
    const anonymous = getChainService({});
    expect(getChainService({ TATUM_API_KEY: KEY })).toBe(anonymous);
    await expect(anonymous.getUsdPrice('USDC')).rejects.toBeInstanceOf(MissingApiKeyError);
    resetChainService();
    const keyed = getChainService({ TATUM_API_KEY: KEY });
    expect(keyed).not.toBe(anonymous);
    resetChainService();
  });
});
