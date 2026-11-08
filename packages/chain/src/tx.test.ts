import { describe, expect, it } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import {
  MEMWAL_PACKAGE_ID,
  MEMWAL_REGISTRY_ID,
  MEMWAL_TARGETS,
  USDC_COIN_TYPE,
  USDC_DECIMALS,
  buildAddDelegateKeyTx,
  buildCreateAccountTx,
  buildRemoveDelegateKeyTx,
} from './tx/index.js';
import type { Transaction } from '@mysten/sui/transactions';

const ACCOUNT_ID = '0x212ffaa5009725d12f70e2699e5163a1f93f4d5574c2c9c2b87a2b243493d56e';
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

/** Round-trips through the serialized JSON form, as a wallet would receive it. */
async function serialized(tx: Transaction) {
  const json = JSON.parse(await tx.toJSON()) as {
    commands: { MoveCall: { package: string; module: string; function: string; arguments: { Input: number }[] } }[];
    inputs: ({ UnresolvedObject: { objectId: string } } | { Pure: { bytes: string } })[];
  };
  const call = json.commands[0]?.MoveCall;
  if (!call) throw new Error('no move call');
  const args = call.arguments.map((a) => json.inputs[a.Input]);
  return { json, call, target: `${call.package}::${call.module}::${call.function}`, args };
}

const objectArg = (id: string) => ({ UnresolvedObject: { objectId: normalizeSuiAddress(id) } });
const pureArg = (bytes: Uint8Array) => ({ Pure: { bytes: Buffer.from(bytes).toString('base64') } });

describe('MemWal transaction builders', () => {
  it('create_account(registry, clock)', async () => {
    const { json, target, args } = await serialized(buildCreateAccountTx());
    expect(json.commands).toHaveLength(1);
    expect(target).toBe(MEMWAL_TARGETS.createAccount);
    expect(args).toEqual([objectArg(MEMWAL_REGISTRY_ID), objectArg('0x6')]);
  });

  it('add_delegate_key(account, registry, public_key, label, clock)', async () => {
    const { target, args } = await serialized(buildAddDelegateKeyTx({ accountId: ACCOUNT_ID, publicKey32: KEY, label: 'Ferry on Chrome 2026-11-09' }));
    expect(target).toBe(`${MEMWAL_PACKAGE_ID}::account::add_delegate_key`);
    expect(args).toEqual([
      objectArg(ACCOUNT_ID),
      objectArg(MEMWAL_REGISTRY_ID),
      pureArg(bcs.vector(bcs.u8()).serialize(Array.from(KEY)).toBytes()),
      pureArg(bcs.string().serialize('Ferry on Chrome 2026-11-09').toBytes()),
      objectArg('0x6'),
    ]);
  });

  it('remove_delegate_key(account, registry, public_key) has no Clock', async () => {
    const { target, args } = await serialized(buildRemoveDelegateKeyTx({ accountId: ACCOUNT_ID, publicKey32: KEY }));
    expect(target).toBe(MEMWAL_TARGETS.removeDelegateKey);
    expect(args).toEqual([
      objectArg(ACCOUNT_ID),
      objectArg(MEMWAL_REGISTRY_ID),
      pureArg(bcs.vector(bcs.u8()).serialize(Array.from(KEY)).toBytes()),
    ]);
  });

  it('refuses inputs the Move code would abort on', () => {
    expect(() => buildAddDelegateKeyTx({ accountId: ACCOUNT_ID, publicKey32: new Uint8Array(31), label: 'x' })).toThrow(TypeError);
    expect(() => buildRemoveDelegateKeyTx({ accountId: ACCOUNT_ID, publicKey32: new Uint8Array(33) })).toThrow(TypeError);
    expect(() => buildAddDelegateKeyTx({ accountId: ACCOUNT_ID, publicKey32: KEY, label: '' })).toThrow(RangeError);
    expect(() => buildAddDelegateKeyTx({ accountId: ACCOUNT_ID, publicKey32: KEY, label: 'é'.repeat(33) })).toThrow(RangeError);
    expect(() => buildAddDelegateKeyTx({ accountId: 'nope', publicKey32: KEY, label: 'x' })).toThrow(TypeError);
  });

  it('exports the USDC constants', () => {
    expect(USDC_COIN_TYPE.endsWith('::usdc::USDC')).toBe(true);
    expect(USDC_DECIMALS).toBe(6);
  });
});

describe('browser entry', () => {
  it('pulls in no Node-only modules', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = ['tx/index.ts', 'constants.ts', 'address.ts'];
    for (const file of files) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec).not.toMatch(/^node:|@grpc|grpc-transport|\/rpc\.js$|\/tatum\.js$|\/service\.js$/);
      }
    }
  });
});
