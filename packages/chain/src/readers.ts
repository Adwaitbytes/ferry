import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils';
import { AccountView, BlobView } from '@ferry/core';
import {
  MEMWAL_ACCOUNT_TYPE,
  MEMWAL_ACCOUNTS_TABLE_ID,
  WALRUS_BLOB_TYPE,
  WALRUS_STAKING_OBJECT_ID,
  WALRUS_TYPE_PACKAGE_ID,
} from './constants.js';
import { normalizeAddress } from './address.js';
import { TtlCache } from './cache.js';
import { ChainDataError, type ObjectWithContent, type TatumSui } from './rpc.js';
import type { SuiClientTypes } from '@mysten/sui/client';

/* BCS layouts copied from memwal::account (RESEARCH 1.6) and walrus::blob (@mysten/walrus). */

const DelegateKeyBcs = bcs.struct('DelegateKey', {
  public_key: bcs.vector(bcs.u8()),
  sui_address: bcs.Address,
  label: bcs.string(),
  created_at: bcs.u64(),
});

const MemWalAccountBcs = bcs.struct('MemWalAccount', {
  id: bcs.Address,
  owner: bcs.Address,
  delegate_keys: bcs.vector(DelegateKeyBcs),
  created_at: bcs.u64(),
  active: bcs.bool(),
  admin_quarantined: bcs.bool(),
  legacy_account_id: bcs.option(bcs.Address),
  access_counter_version: bcs.u64(),
});

/** `0x2::dynamic_field::Field<address, ID>`: one row of `AccountRegistry.accounts`. */
const AccountsTableFieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.Address,
  value: bcs.Address,
});

const BlobBcs = bcs.struct('Blob', {
  id: bcs.Address,
  registered_epoch: bcs.u32(),
  /** u256 stored little-endian; the Walrus blob id is the base64url of these 32 bytes. */
  blob_id: bcs.fixedArray(32, bcs.u8()),
  size: bcs.u64(),
  encoding_type: bcs.u8(),
  certified_epoch: bcs.option(bcs.u32()),
  storage: bcs.struct('Storage', {
    id: bcs.Address,
    start_epoch: bcs.u32(),
    end_epoch: bcs.u32(),
    storage_size: bcs.u64(),
  }),
  deletable: bcs.bool(),
});

const ACCOUNTS_FIELD_TYPE = normalizeStructTag('0x2::dynamic_field::Field<address, 0x2::object::ID>');
const NORMALIZED_ACCOUNT_TYPE = normalizeStructTag(MEMWAL_ACCOUNT_TYPE);
const NORMALIZED_BLOB_TYPE = normalizeStructTag(WALRUS_BLOB_TYPE);
const STAKING_INNER_FIELD_TYPE = normalizeStructTag(
  `0x2::dynamic_field::Field<u64, ${WALRUS_TYPE_PACKAGE_ID}::staking_inner::StakingInnerV1>`,
);

/** Walrus blob id: 32 bytes as unpadded base64url (43 chars). */
export const WALRUS_BLOB_ID = /^[A-Za-z0-9_-]{43}$/;

function sameType(object: ObjectWithContent, normalizedType: string): boolean {
  try {
    return normalizeStructTag(object.type) === normalizedType;
  } catch {
    return false;
  }
}

function parse<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch {
    throw new ChainDataError(`could not decode ${what}`);
  }
}

function msToIso(ms: string): string | null {
  const n = Number(ms);
  return n > 0 && Number.isSafeInteger(n) ? new Date(n).toISOString() : null;
}

export function blobIdFromBytes(bytes: Iterable<number>): string {
  return toBase64(Uint8Array.from(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function ownerAddress(owner: SuiClientTypes.ObjectOwner): string | null {
  switch (owner.$kind) {
    case 'AddressOwner':
      return normalizeAddress(owner.AddressOwner);
    case 'ConsensusAddressOwner':
      return normalizeAddress(owner.ConsensusAddressOwner.owner);
    default:
      return null;
  }
}

/** Account fields that AccountView does not carry yet (see the proposed core diff). */
export interface AccountDetails {
  view: AccountView;
  createdAt: string | null;
  adminQuarantined: boolean;
  accessCounterVersion: string;
}

/** Decodes a MemWalAccount object. Pure: used by the readers and by fixture tests. */
export function decodeAccount(object: ObjectWithContent): AccountDetails {
  if (!sameType(object, NORMALIZED_ACCOUNT_TYPE)) throw new ChainDataError('object is not a MemWalAccount');
  const raw = parse('MemWalAccount', () => MemWalAccountBcs.parse(object.content));
  const view = AccountView.parse({
    accountId: normalizeAddress(raw.id),
    owner: normalizeAddress(raw.owner),
    active: raw.active,
    delegates: raw.delegate_keys.map((key) => ({
      // MEMWAL_AGENT_ID format: 64 hex chars, no 0x (RESEARCH 1.1).
      publicKey: toHex(Uint8Array.from(key.public_key)),
      suiAddress: normalizeAddress(key.sui_address),
      label: key.label,
      createdAt: msToIso(key.created_at),
    })),
    version: object.version,
  });
  return {
    view,
    createdAt: msToIso(raw.created_at),
    adminQuarantined: raw.admin_quarantined,
    accessCounterVersion: raw.access_counter_version,
  };
}

/** Decodes one `AccountRegistry.accounts` table row into the account id it points to. */
export function decodeAccountsTableField(object: ObjectWithContent, owner: string): string {
  if (!sameType(object, ACCOUNTS_FIELD_TYPE)) throw new ChainDataError('object is not an accounts table row');
  const raw = parse('accounts table row', () => AccountsTableFieldBcs.parse(object.content));
  if (normalizeAddress(raw.name) !== normalizeAddress(owner)) throw new ChainDataError('accounts table row key mismatch');
  return normalizeAddress(raw.value);
}

export interface DecodedBlob {
  blobId: string;
  objectId: string;
  owner: string | null;
  certifiedEpoch: number | null;
  endEpoch: number;
  registeredEpoch: number;
  size: string;
  deletable: boolean;
}

export function decodeBlob(object: ObjectWithContent): DecodedBlob {
  if (!sameType(object, NORMALIZED_BLOB_TYPE)) throw new ChainDataError('object is not a Walrus Blob');
  const raw = parse('Walrus Blob', () => BlobBcs.parse(object.content));
  return {
    blobId: blobIdFromBytes(raw.blob_id),
    objectId: normalizeAddress(raw.id),
    owner: ownerAddress(object.owner),
    certifiedEpoch: raw.certified_epoch ?? null,
    endEpoch: raw.storage.end_epoch,
    registeredEpoch: raw.registered_epoch,
    size: raw.size,
    deletable: raw.deletable,
  };
}

export interface WalrusEpochInfo {
  epoch: number;
  epochDurationMs: number;
  firstEpochStartMs: number;
}

/**
 * `StakingInnerV1` begins with fixed-size fields, so the epoch sits at a fixed offset and the
 * large committee data after it never needs decoding. Layout of the dynamic field content:
 * UID (32) | name u64 (8) | n_shards u16 (2) | epoch_duration u64 (8) | first_epoch_start u64 (8)
 * | pools ObjectTable { id (32), size u64 (8) } | epoch u32 (4).
 */
export function decodeWalrusStakingInner(object: ObjectWithContent): WalrusEpochInfo {
  if (!sameType(object, STAKING_INNER_FIELD_TYPE)) throw new ChainDataError('object is not the Walrus staking state');
  const bytes = object.content;
  if (bytes.length < 102) throw new ChainDataError('Walrus staking state is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    epochDurationMs: Number(view.getBigUint64(42, true)),
    firstEpochStartMs: Number(view.getBigUint64(50, true)),
    epoch: view.getUint32(98, true),
  };
}

/** `walrus::staking::Staking` is `{ id: UID, version: u64, ... }`; version picks the inner field. */
export function decodeWalrusStakingVersion(object: ObjectWithContent): bigint {
  const bytes = object.content;
  if (bytes.length < 40) throw new ChainDataError('Walrus staking object is truncated');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(32, true);
}

export interface EpochInfo {
  sui: { epoch: number };
  walrus: WalrusEpochInfo;
}

const STAKING_VERSION_TTL_MS = 600_000;
const WALRUS_EPOCH_TTL_MS = 60_000;

/** Typed reads of MemWal and Walrus objects through Tatum. */
export class ChainReaders {
  readonly #sui: TatumSui;
  readonly #walrus = new TtlCache<WalrusEpochInfo>({ maxEntries: 1 });

  constructor(sui: TatumSui) {
    this.#sui = sui;
  }

  /** `null` when the object does not exist. Throws ChainDataError when it is not a MemWalAccount. */
  async readAccountDetails(accountId: string): Promise<AccountDetails | null> {
    const object = await this.#sui.getObject(accountId);
    return object ? decodeAccount(object) : null;
  }

  async readAccount(accountId: string): Promise<AccountView | null> {
    return (await this.readAccountDetails(accountId))?.view ?? null;
  }

  /** Looks up `AccountRegistry.accounts[owner]` by deriving the table row's object id locally. */
  async findAccountByOwner(owner: string): Promise<string | null> {
    const normalizedOwner = normalizeAddress(owner);
    const fieldId = deriveDynamicFieldID(
      MEMWAL_ACCOUNTS_TABLE_ID,
      'address',
      bcs.Address.serialize(normalizedOwner).toBytes(),
    );
    const row = await this.#sui.getObject(fieldId);
    return row ? decodeAccountsTableField(row, normalizedOwner) : null;
  }

  async readAccountByOwner(owner: string): Promise<AccountView | null> {
    const accountId = await this.findAccountByOwner(owner);
    return accountId ? this.readAccount(accountId) : null;
  }

  /** Current Walrus epoch (not the Sui epoch): Staking.version, then its StakingInnerV1 field. */
  async walrusEpoch(): Promise<WalrusEpochInfo> {
    const { value, hit } = await this.#walrus.getOrLoad('walrus', WALRUS_EPOCH_TTL_MS, async () => {
      const staking = await this.#sui.getObject(WALRUS_STAKING_OBJECT_ID, STAKING_VERSION_TTL_MS);
      if (!staking) throw new ChainDataError('Walrus staking object not found');
      const version = decodeWalrusStakingVersion(staking);
      const fieldId = deriveDynamicFieldID(WALRUS_STAKING_OBJECT_ID, 'u64', bcs.u64().serialize(version).toBytes());
      const inner = await this.#sui.getObject(fieldId, WALRUS_EPOCH_TTL_MS);
      if (!inner) throw new ChainDataError('Walrus staking state not found');
      return decodeWalrusStakingInner(inner);
    });
    if (hit) this.#sui.meter.cacheHit('WalrusEpoch');
    return value;
  }

  async currentEpoch(): Promise<EpochInfo> {
    const [sui, walrus] = await Promise.all([this.#sui.getSuiEpoch(), this.walrusEpoch()]);
    return { sui: { epoch: Number(sui) }, walrus };
  }

  /**
   * Accepts a Blob object id (0x...) or a Walrus blob id. Sui has no index from blob id to Blob
   * object, so a bare blob id returns only the current epoch unless `objectId` is supplied, in
   * which case the object must carry that blob id. Returns `null` when the object is missing.
   */
  async readBlob(blobIdOrObjectId: string, options: { objectId?: string } = {}): Promise<BlobView | null> {
    const isObjectId = blobIdOrObjectId.startsWith('0x');
    const objectId = isObjectId ? blobIdOrObjectId : options.objectId;
    if (!isObjectId && !WALRUS_BLOB_ID.test(blobIdOrObjectId)) throw new TypeError('invalid Walrus blob id');
    const [walrus, object] = await Promise.all([
      this.walrusEpoch(),
      objectId ? this.#sui.getObject(objectId) : Promise.resolve(undefined),
    ]);
    if (object === undefined) {
      return BlobView.parse({
        blobId: blobIdOrObjectId,
        objectId: null,
        owner: null,
        certifiedEpoch: null,
        endEpoch: null,
        currentEpoch: walrus.epoch,
      });
    }
    if (object === null) return null;
    const blob = decodeBlob(object);
    if (!isObjectId && blob.blobId !== blobIdOrObjectId) throw new ChainDataError('Blob object does not carry that blob id');
    return BlobView.parse({
      blobId: blob.blobId,
      objectId: blob.objectId,
      owner: blob.owner,
      certifiedEpoch: blob.certifiedEpoch,
      endEpoch: blob.endEpoch,
      currentEpoch: walrus.epoch,
    });
  }
}
