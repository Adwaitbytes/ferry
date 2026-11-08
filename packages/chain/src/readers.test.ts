import { describe, expect, it } from 'vitest';
import { AccountView, BlobView } from '@ferry/core';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import {
  ChainReaders,
  blobIdFromBytes,
  decodeAccount,
  decodeAccountsTableField,
  decodeBlob,
  decodeWalrusStakingInner,
  decodeWalrusStakingVersion,
} from './readers.js';
import { ChainDataError, TatumSui } from './rpc.js';
import { MEMWAL_ACCOUNTS_TABLE_ID, MEMWAL_REGISTRY_ID, WALRUS_STAKING_OBJECT_ID } from './constants.js';
import { fakeClock, fakeRpc, fixtureObject } from './fixtures.testutil.js';
import type { ObjectWithContent } from './rpc.js';

const ACCOUNT_ID = '0x212ffaa5009725d12f70e2699e5163a1f93f4d5574c2c9c2b87a2b243493d56e';
const OWNER = '0x80086403f99ead1f34d51b8e55a53377bf5574bc2b35796b3153948060828b73';
const ROW_ID = '0x0005632c7009535dccdadf19f2d3a618f4a575978c5e99ee085af895abfdea17';
const BLOB_OBJECT_ID = '0xa16ff652a8e38de8cab5d7393f449c6faeaf3f90467d2bab7c4bfafbb90436b0';
const INNER_ID = '0x0ae6c892c35c5532c69c00e1655936ec11b701a3b04951dc63420386e37ef3cb';

const account = fixtureObject('account.json');
const row = fixtureObject('registry-field.json');
const blob = fixtureObject('blob.json');
const staking = fixtureObject('walrus-staking.json');
const stakingInner = fixtureObject('walrus-staking-inner.json');
const registry = fixtureObject('registry.json');

/** Walrus encodes the u256 blob id little-endian, then base64url without padding. */
function blobIdFromDecimal(decimal: string): string {
  let n = BigInt(decimal);
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 1) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  return Buffer.from(bytes).toString('base64url');
}

function world() {
  const objects: Record<string, ObjectWithContent> = {
    [ACCOUNT_ID]: account,
    [ROW_ID]: row,
    [BLOB_OBJECT_ID]: blob,
    [WALRUS_STAKING_OBJECT_ID]: staking,
    [INNER_ID]: stakingInner,
  };
  const { rpc, mocks } = fakeRpc(objects);
  const sui = new TatumSui({ rpc, clock: fakeClock(), ratePerSec: 1000 });
  return { readers: new ChainReaders(sui), sui, mocks };
}

describe('fixture decoding (real Mainnet objects)', () => {
  it('decodes a MemWalAccount into a core AccountView', () => {
    const details = decodeAccount(account);
    expect(AccountView.parse(details.view)).toEqual(details.view);
    expect(details.view).toEqual({
      accountId: ACCOUNT_ID,
      owner: OWNER,
      active: true,
      delegates: [
        {
          publicKey: '745d25c00f7889d8a4708e3e129df0b6ef442f3594b51a6ef640b546b5909a25',
          suiAddress: '0x19e0e7ff343f5ccdef9c95f106bf71f8e412a8d85c9d4915882ee3a7e44f7cbf',
          label: 'Web App',
          createdAt: new Date(1791094447118).toISOString(),
        },
      ],
      version: '1033038161',
    });
    expect(details.createdAt).toBe(new Date(1791094440960).toISOString());
    expect(details.adminQuarantined).toBe(false);
    expect(details.accessCounterVersion).toBe('0');
  });

  it('agrees with the node JSON for the same account (independent decode path)', () => {
    const json = (account as unknown as { json: { delegate_keys: { public_key: string }[] } }).json;
    const fromJson = Buffer.from(json.delegate_keys[0]?.public_key ?? '', 'base64').toString('hex');
    expect(decodeAccount(account).view.delegates[0]?.publicKey).toBe(fromJson);
  });

  it('rejects an object of another type as a MemWalAccount', () => {
    expect(() => decodeAccount(blob)).toThrow(ChainDataError);
  });

  it('rejects corrupt account bytes', () => {
    expect(() => decodeAccount({ ...account, content: account.content.slice(0, 40) })).toThrow(/could not decode/);
  });

  it('maps a zero created_at to null', () => {
    const raw = bcs
      .struct('A', {
        id: bcs.Address,
        owner: bcs.Address,
        delegate_keys: bcs.vector(
          bcs.struct('K', { public_key: bcs.vector(bcs.u8()), sui_address: bcs.Address, label: bcs.string(), created_at: bcs.u64() }),
        ),
        created_at: bcs.u64(),
        active: bcs.bool(),
        admin_quarantined: bcs.bool(),
        legacy_account_id: bcs.option(bcs.Address),
        access_counter_version: bcs.u64(),
      })
      .serialize({
        id: ACCOUNT_ID,
        owner: OWNER,
        delegate_keys: [{ public_key: new Array(32).fill(1), sui_address: OWNER, label: 'x', created_at: 0n }],
        created_at: 0n,
        active: false,
        admin_quarantined: true,
        legacy_account_id: OWNER,
        access_counter_version: 7n,
      })
      .toBytes();
    const details = decodeAccount({ ...account, content: new Uint8Array(raw) });
    expect(details.createdAt).toBeNull();
    expect(details.view.delegates[0]?.createdAt).toBeNull();
    expect(details.view.active).toBe(false);
    expect(details.adminQuarantined).toBe(true);
    expect(details.accessCounterVersion).toBe('7');
  });

  it('decodes the registry accounts table row and checks its key', () => {
    expect(decodeAccountsTableField(row, OWNER)).toBe(ACCOUNT_ID);
    expect(() => decodeAccountsTableField(row, '0x1')).toThrow(/key mismatch/);
    expect(() => decodeAccountsTableField(account, OWNER)).toThrow(ChainDataError);
  });

  it('derives the same table row id the node reports', () => {
    expect(deriveDynamicFieldID(MEMWAL_ACCOUNTS_TABLE_ID, 'address', bcs.Address.serialize(OWNER).toBytes())).toBe(ROW_ID);
  });

  it('registry object holds the accounts table id we hard-code', () => {
    expect(registry.objectId).toBe(MEMWAL_REGISTRY_ID);
    expect(Buffer.from(registry.content.slice(32, 64)).toString('hex')).toBe(MEMWAL_ACCOUNTS_TABLE_ID.slice(2));
  });

  it('decodes a Walrus Blob object', () => {
    const decoded = decodeBlob(blob);
    expect(decoded).toEqual({
      blobId: blobIdFromDecimal('75467250915991149768855881235279857345930657237367385347776622280481042414868'),
      objectId: BLOB_OBJECT_ID,
      owner: '0x1d54265966ddb047ba664ad592a9c55c8007d7eff0dd67d12f64d0ebbdc4149d',
      certifiedEpoch: 43,
      endEpoch: 58,
      registeredEpoch: 43,
      size: '2579',
      deletable: true,
    });
    expect(() => decodeBlob(account)).toThrow(ChainDataError);
  });

  it('reports a null owner for blobs that are not address-owned', () => {
    expect(decodeBlob({ ...blob, owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } } }).owner).toBeNull();
    const consensus = decodeBlob({
      ...blob,
      owner: { $kind: 'ConsensusAddressOwner', ConsensusAddressOwner: { startVersion: '1', owner: '0x2' } },
    });
    expect(consensus.owner).toBe(`0x${'0'.repeat(63)}2`);
  });

  it('encodes blob ids as unpadded base64url', () => {
    expect(blobIdFromBytes(new Array(32).fill(0xff))).toBe(`${'_'.repeat(42)}8`);
    expect(blobIdFromBytes(new Array(32).fill(0xfb))).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('reads the Walrus epoch from the staking state prefix', () => {
    expect(decodeWalrusStakingVersion(staking)).toBe(4n);
    expect(decodeWalrusStakingInner(stakingInner)).toEqual({
      epoch: 43,
      epochDurationMs: 1_209_600_000,
      firstEpochStartMs: 1_742_914_804_744,
    });
    expect(deriveDynamicFieldID(WALRUS_STAKING_OBJECT_ID, 'u64', bcs.u64().serialize(4n).toBytes())).toBe(INNER_ID);
    expect(() => decodeWalrusStakingInner(blob)).toThrow(ChainDataError);
    expect(() => decodeWalrusStakingInner({ ...stakingInner, content: stakingInner.content.slice(0, 50) })).toThrow(/truncated/);
    expect(() => decodeWalrusStakingVersion({ ...staking, content: new Uint8Array(10) })).toThrow(/truncated/);
  });
});

describe('ChainReaders', () => {
  it('readAccount returns the view, or null for a missing object', async () => {
    const { readers } = world();
    expect((await readers.readAccount(ACCOUNT_ID))?.owner).toBe(OWNER);
    expect(await readers.readAccount(`0x${'ab'.repeat(32)}`)).toBeNull();
  });

  it('finds the account for an owner through the registry table', async () => {
    const { readers, mocks } = world();
    expect(await readers.findAccountByOwner(OWNER.toUpperCase().replace('0X', '0x'))).toBe(ACCOUNT_ID);
    expect(mocks.getObjects).toHaveBeenCalledWith({ objectIds: [ROW_ID], include: { content: true } });
    expect((await readers.readAccountByOwner(OWNER))?.accountId).toBe(ACCOUNT_ID);
    expect(await readers.findAccountByOwner(`0x${'cd'.repeat(32)}`)).toBeNull();
    expect(await readers.readAccountByOwner(`0x${'cd'.repeat(32)}`)).toBeNull();
  });

  it('reads the Walrus epoch once per minute', async () => {
    const { readers, sui, mocks } = world();
    const first = await readers.walrusEpoch();
    const second = await readers.walrusEpoch();
    expect(first.epoch).toBe(43);
    expect(second).toEqual(first);
    expect(mocks.getObjects).toHaveBeenCalledTimes(2);
    expect(sui.getMeter().methods['WalrusEpoch']?.cacheHits).toBe(1);
  });

  it('fails clearly when the Walrus staking objects are missing', async () => {
    const { rpc } = fakeRpc({});
    const readers = new ChainReaders(new TatumSui({ rpc, clock: fakeClock(), ratePerSec: 1000 }));
    await expect(readers.walrusEpoch()).rejects.toThrow(/staking object not found/);
    const { rpc: rpc2 } = fakeRpc({ [WALRUS_STAKING_OBJECT_ID]: staking });
    const readers2 = new ChainReaders(new TatumSui({ rpc: rpc2, clock: fakeClock(), ratePerSec: 1000 }));
    await expect(readers2.walrusEpoch()).rejects.toThrow(/staking state not found/);
  });

  it('currentEpoch returns both Sui and Walrus epochs', async () => {
    const { readers } = world();
    expect(await readers.currentEpoch()).toEqual({
      sui: { epoch: 1305 },
      walrus: { epoch: 43, epochDurationMs: 1_209_600_000, firstEpochStartMs: 1_742_914_804_744 },
    });
  });

  it('readBlob by object id returns a core BlobView', async () => {
    const { readers } = world();
    const view = await readers.readBlob(BLOB_OBJECT_ID);
    expect(view && BlobView.parse(view)).toEqual({
      blobId: decodeBlob(blob).blobId,
      objectId: BLOB_OBJECT_ID,
      owner: '0x1d54265966ddb047ba664ad592a9c55c8007d7eff0dd67d12f64d0ebbdc4149d',
      certifiedEpoch: 43,
      endEpoch: 58,
      currentEpoch: 43,
    });
    expect(await readers.readBlob(`0x${'ee'.repeat(32)}`)).toBeNull();
  });

  it('readBlob by blob id alone returns only the current epoch', async () => {
    const { readers } = world();
    const id = decodeBlob(blob).blobId;
    expect(await readers.readBlob(id)).toEqual({
      blobId: id,
      objectId: null,
      owner: null,
      certifiedEpoch: null,
      endEpoch: null,
      currentEpoch: 43,
    });
  });

  it('readBlob by blob id plus object id cross-checks the blob id', async () => {
    const { readers } = world();
    const id = decodeBlob(blob).blobId;
    expect((await readers.readBlob(id, { objectId: BLOB_OBJECT_ID }))?.endEpoch).toBe(58);
    await expect(readers.readBlob(`A${id.slice(1)}`, { objectId: BLOB_OBJECT_ID })).rejects.toThrow(/does not carry/);
    await expect(readers.readBlob('not a blob id')).rejects.toThrow(TypeError);
  });
});
