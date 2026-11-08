import type { FactType, LibraryItem, MemoryStatus, StoredMemory, Vendor } from '@ferry/core';
import { ACCOUNT_ID, DEVICE_PUBLIC_KEY_HEX, type ExtensionSeed } from './protocol';

interface MemorySpec {
  ref: string;
  text: string;
  type?: FactType;
  vendor?: Vendor;
  status?: MemoryStatus;
  at?: string;
}

export function storedMemory({ ref, text, type = 'preference', vendor = 'chatgpt', status = 'active', at = '2026-10-12' }: MemorySpec): StoredMemory {
  return {
    ref,
    namespace: 'ferry-core',
    text,
    header: {
      v: 1,
      type,
      sources: [vendor],
      convHash: 'Q29udkhhc2gx',
      at,
      confidence: 0.92,
      quoteHash: 'UXVvdGVIYXNo',
      supersedes: null,
      status: status === 'hidden' ? 'hidden' : 'active',
    },
    status,
    receipts: [
      {
        vendor,
        conversationIdHash: 'Q29udkhhc2gx',
        messageAt: `${at}T09:30:00.000Z`,
        quote: text,
        quoteHash: 'UXVvdGVIYXNo',
        confidence: 0.92,
      },
    ],
    writtenAt: `${at}T09:31:00.000Z`,
    supersededBy: null,
    endEpoch: 1210,
  };
}

export function libraryItem(spec: MemorySpec): LibraryItem {
  return { memory: storedMemory(spec), endEpoch: 1210, blobId: `blob_${spec.ref}` };
}

export const CASHEW = libraryItem({ ref: 'mem_cashew_0001', text: 'Allergic to cashews.', type: 'constraint', vendor: 'chatgpt' });
export const LISBON = libraryItem({ ref: 'mem_lisbon_0002', text: 'Lives in Lisbon.', type: 'identity', vendor: 'claude', at: '2026-09-02' });
export const TYPESCRIPT = libraryItem({ ref: 'mem_typescript_03', text: 'Writes TypeScript at work.', type: 'skill', vendor: 'gemini', at: '2026-08-20' });

export const CONFLICT_ID = '7c1f0e9a-4b2d-4c3e-8f5a-6b7c8d9e0f1a';

/** An open F5 conflict: the stored fact says vegetarian, a newer chat says the user eats fish now. */
export const VEGETARIAN_CONFLICT: LibraryItem = {
  ...libraryItem({ ref: 'mem_vegetarian_04', text: 'Vegetarian.', type: 'preference', vendor: 'chatgpt', status: 'conflict', at: '2026-03-01' }),
  conflict: {
    conflictId: CONFLICT_ID,
    otherRef: 'cand_pescatarian_05',
    otherText: 'Eats fish now, still no meat.',
    otherSources: ['claude'],
    otherHeardAt: '2026-10-30',
    verdict: 'contradicts',
  },
};

export function pairedSeed(items: LibraryItem[] = [CASHEW, LISBON, TYPESCRIPT]): ExtensionSeed {
  return {
    hasVault: true,
    locked: false,
    paired: true,
    accountId: ACCOUNT_ID,
    owner: null,
    publicKeyHex: DEVICE_PUBLIC_KEY_HEX,
    items,
    writesPerPoll: 3,
  };
}

export function unpairedSeed(): ExtensionSeed {
  return { ...pairedSeed([]), paired: false, accountId: null };
}
