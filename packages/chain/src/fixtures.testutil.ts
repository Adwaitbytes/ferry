import { readFileSync } from 'node:fs';
import { fromHex } from '@mysten/sui/utils';
import { ObjectError } from '@mysten/sui/client';
import { vi, type Mock } from 'vitest';
import type { Clock } from './clock.js';
import type { ObjectWithContent, PaymentTransaction, SuiRpc } from './rpc.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);

/** Fixtures were captured from Sui Mainnet with byte arrays stored as `{ "$bytes": hex }`. */
export function loadFixture<T>(name: string): T {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- names are fixed strings in tests
  const text = readFileSync(new URL(name, FIXTURES), 'utf8');
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null && '$bytes' in value) {
      return fromHex((value as { $bytes: string }).$bytes);
    }
    return value;
  }) as T;
}

export const fixtureObject = (name: string): ObjectWithContent => loadFixture<ObjectWithContent>(name);

/** Sleeps resolve at once; by default they also advance time, as a sequential caller would see. */
export function fakeClock(
  start = 1_794_312_000_000,
  options: { advanceOnSleep?: boolean } = {},
): Clock & { advance(ms: number): void; sleeps: number[] } {
  let now = start;
  const sleeps: number[] = [];
  const advanceOnSleep = options.advanceOnSleep ?? true;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      if (advanceOnSleep) now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

type TxResponse = { $kind: string; Transaction?: PaymentTransaction; FailedTransaction?: PaymentTransaction };

export interface FakeRpcMocks {
  getObjects: Mock<(input: { objectIds: string[] }) => Promise<{ objects: (ObjectWithContent | Error)[] }>>;
  getTransaction: Mock<(input: { digest: string }) => Promise<TxResponse>>;
  listTransactions: Mock<(input: unknown) => Promise<unknown>>;
  getBalance: Mock<(input: unknown) => Promise<unknown>>;
  executeTransaction: Mock<(input: unknown) => Promise<unknown>>;
  simulateTransaction: Mock<(input: unknown) => Promise<unknown>>;
  getEpoch: Mock<(input: unknown) => Promise<{ response: { epoch?: { epoch?: bigint } } }>>;
}

/** A mock of the SuiGrpcClient boundary that serves objects by id from a map. */
export function fakeRpc(objects: Record<string, ObjectWithContent> = {}, epoch = 1305n): { rpc: SuiRpc; mocks: FakeRpcMocks } {
  const mocks: FakeRpcMocks = {
    getObjects: vi.fn(async ({ objectIds }: { objectIds: string[] }) => ({
      objects: objectIds.map((id) => objects[id] ?? notFound(id)),
    })),
    getTransaction: vi.fn(async (): Promise<TxResponse> => {
      throw new Error('no transaction');
    }),
    listTransactions: vi.fn(async () => ({ transactions: [], hasNextPage: false, startCursor: null, endCursor: null })),
    getBalance: vi.fn(async () => ({ balance: { coinType: 'x', balance: '5', coinBalance: '5', addressBalance: '0' } })),
    executeTransaction: vi.fn(async (): Promise<unknown> => undefined),
    simulateTransaction: vi.fn(async (): Promise<unknown> => undefined),
    getEpoch: vi.fn(async () => ({ response: { epoch: { epoch } } })),
  };
  const { getEpoch, ...core } = mocks;
  const rpc = { core, ledgerService: { getEpoch } };
  return { rpc: rpc as unknown as SuiRpc, mocks };
}

export function notFound(id: string): Error {
  return new ObjectError('notExists', `object ${id} not found`, { reason: 'notFound', objectId: id });
}
