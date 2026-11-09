import { afterEach, describe, expect, it } from 'vitest';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { createChainService, getChainService, resetChainService } from './service.js';
import { MissingApiKeyError, createTatumGrpcClient, suiNetworkFromEnv, tatumApiKeyFromEnv, tatumApiKeyOrNull, tatumGrpcHost } from './tatum.js';
import { TATUM_SUI_GRPC_HOST, TESTNET_USDC_COIN_TYPE, USDC_COIN_TYPE, USDC_COIN_TYPES, WALRUS_STAKING_OBJECT_ID } from './constants.js';
import { fakeRpc, fixtureObject, loadFixture } from './fixtures.testutil.js';
import type { PaymentTransaction } from './rpc.js';
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
    expect(createTatumGrpcClient({ apiKey: null, network: 'testnet' }).network).toBe('testnet');
  });
});

describe('payment network', () => {
  const TESTNET_KEY = ['t', 'k'].join('');

  it('reads SUI_NETWORK, defaults to mainnet and refuses anything else', () => {
    expect(suiNetworkFromEnv({})).toBe('mainnet');
    expect(suiNetworkFromEnv({ SUI_NETWORK: ' Testnet ' })).toBe('testnet');
    expect(() => suiNetworkFromEnv({ SUI_NETWORK: 'devnet' })).toThrow(/mainnet or testnet/);
  });

  it('picks the Tatum testnet gateway unless TATUM_SUI_GRPC_URL overrides it', () => {
    expect(tatumGrpcHost({}, 'testnet')).toBe('sui-testnet-grpc.gateway.tatum.io:443');
    expect(tatumGrpcHost({ TATUM_SUI_GRPC_URL: 'example.com:8443' }, 'testnet')).toBe('example.com:8443');
  });

  it('prefers TATUM_API_KEY_TESTNET on testnet, then TATUM_API_KEY, then keyless', () => {
    expect(tatumApiKeyOrNull({ TATUM_API_KEY: KEY, TATUM_API_KEY_TESTNET: TESTNET_KEY }, 'testnet')).toBe(TESTNET_KEY);
    expect(tatumApiKeyOrNull({ TATUM_API_KEY: KEY, TATUM_API_KEY_TESTNET: TESTNET_KEY }, 'mainnet')).toBe(KEY);
    expect(tatumApiKeyOrNull({ TATUM_API_KEY: KEY }, 'testnet')).toBe(KEY);
    expect(tatumApiKeyOrNull({ TATUM_API_KEY_TESTNET: '  ' }, 'testnet')).toBeNull();
  });

  it('maps each network to its Circle USDC type', () => {
    expect(USDC_COIN_TYPES.mainnet).toBe(USDC_COIN_TYPE);
    expect(USDC_COIN_TYPES.testnet).toBe(TESTNET_USDC_COIN_TYPE);
    expect(TESTNET_USDC_COIN_TYPE).toBe('0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC');
  });

  it('a testnet service verifies against Testnet USDC by default and rejects Mainnet USDC', async () => {
    const real = loadFixture<PaymentTransaction>('usdc-transfer-tx.json');
    const payee = '0x7eebeaaf0140c5515c1098a8336c804c19da9d94aeaacbdef4049d54e673e4c3';
    const at = real.timestampMs ?? 0;
    const input = { digest: real.digest, recipient: payee, minAmountMicros: 1n, notBeforeMs: at - 1000, notAfterMs: at + 1000 };
    const serving = (tx: PaymentTransaction) => {
      const { rpc, mocks } = fakeRpc();
      mocks.getTransaction.mockImplementation((async () => ({ $kind: 'Transaction', Transaction: tx })) as never);
      return rpc;
    };
    const onTestnet = {
      ...real,
      balanceChanges: real.balanceChanges.map((change) => (change.coinType === USDC_COIN_TYPE ? { ...change, coinType: TESTNET_USDC_COIN_TYPE } : change)),
    };

    expect(createChainService({ rpc: serving(real), apiKey: null }).network).toBe('mainnet');
    expect(await createChainService({ rpc: serving(real), apiKey: null }).verifyUsdcPayment(input)).toMatchObject({ ok: true });
    expect(await createChainService({ rpc: serving(real), apiKey: null, network: 'testnet' }).verifyUsdcPayment(input)).toMatchObject({
      ok: false,
      reason: 'WRONG_COIN',
    });
    expect(await createChainService({ rpc: serving(onTestnet), apiKey: null, network: 'testnet' }).verifyUsdcPayment(input)).toMatchObject({
      ok: true,
      coinType: TESTNET_USDC_COIN_TYPE,
    });
    expect(await createChainService({ rpc: serving(onTestnet), apiKey: null }).verifyUsdcPayment(input)).toMatchObject({ ok: false, reason: 'WRONG_COIN' });
  });

  it('getChainService follows SUI_NETWORK', () => {
    expect(getChainService({ SUI_NETWORK: 'testnet' }).network).toBe('testnet');
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
