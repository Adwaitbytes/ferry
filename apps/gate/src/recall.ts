import { FactType, MAX_FACT_CHARS, MemoryRef, Vendor, decodeMemory, type GateRecallResult } from '@ferry/core';
import { PUBLIC_NAMESPACE } from '@ferry/pay';
import { MemWal } from '@mysten-incubation/memwal';

export type PublicFact = GateRecallResult['results'][number];

/** Recall over the Public profile account only. Injected so tests never reach the relayer. */
export interface PublicRecall {
  recall(query: string, limit: number): Promise<PublicFact[]>;
}

/**
 * Turns stored memory text into a public fact. Only `t`, `s` and `at` leave the Gate: the
 * conversation hash `c=` and quote hash `q=` are dropped (X-GATE-3), and anything without a
 * valid active Ferry header is not served, because it was not published through Ferry.
 */
export function toPublicFact(memoryText: string, memoryRef: string): PublicFact | null {
  const decoded = decodeMemory(memoryText);
  if (!decoded.ok || decoded.header.status !== 'active') return null;
  const text = decoded.factText.trim();
  if (text.length === 0 || text.length > MAX_FACT_CHARS) return null;
  const type = FactType.safeParse(decoded.header.type);
  const sources = Vendor.array().safeParse(decoded.header.sources);
  if (!type.success || !sources.success || !MemoryRef.safeParse(memoryRef).success) return null;
  return { text, type: type.data, sources: sources.data, heardAt: decoded.header.at, memoryRef };
}

export interface MemwalRecallConfig {
  delegateKey: string;
  accountId: string;
  relayerUrl: string;
}

/**
 * One MemWal instance per process (RESEARCH 1.2: a new instance per call means a new SEAL
 * session). The namespace is fixed to `ferry-public` here and on every call (X-GATE-1).
 */
export function memwalPublicRecall(config: MemwalRecallConfig): PublicRecall {
  const memwal = MemWal.create({ key: config.delegateKey, accountId: config.accountId, serverUrl: config.relayerUrl, namespace: PUBLIC_NAMESPACE });
  return {
    async recall(query, limit) {
      const result = await memwal.recall({ query, limit, namespace: PUBLIC_NAMESPACE });
      const facts: PublicFact[] = [];
      for (const hit of result.results) {
        const fact = toPublicFact(hit.text, hit.blob_id);
        if (fact) facts.push(fact);
      }
      return facts;
    },
  };
}
