import type { FactType } from '@ferry/core';

/**
 * Types that change what an assistant should do (allergies, hard limits, who the user is) win ties
 * over types that are nice to know.
 */
export const TYPE_BOOST: Readonly<Record<FactType, number>> = {
  constraint: 0.12,
  identity: 0.1,
  dislike: 0.08,
  preference: 0.08,
  person: 0.05,
  project: 0.05,
  goal: 0.04,
  routine: 0.03,
  decision: 0.03,
  skill: 0.02,
  lesson: 0.02,
};

export interface RankInput {
  distance: number;
  /** Epoch ms of when the fact was written or heard. */
  at: number;
  confidence: number;
  type: FactType;
  /** Returned by both the relevance and the recent recall. */
  inBoth: boolean;
}

export const RANK_WEIGHTS = { relevance: 0.6, recency: 0.2, confidence: 0.2, both: 0.05 } as const;
export const RECENCY_HALF_LIFE_DAYS = 30;
const DAY_MS = 86_400_000;

export function recencyDecay(at: number, now: number, halfLifeDays: number = RECENCY_HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, now - at) / DAY_MS;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function scoreCandidate(input: RankInput, now: number): number {
  const relevance = 1 - Math.min(1, Math.max(0, input.distance));
  const score =
    RANK_WEIGHTS.relevance * relevance +
    RANK_WEIGHTS.recency * recencyDecay(input.at, now) +
    RANK_WEIGHTS.confidence * Math.min(1, Math.max(0, input.confidence)) +
    TYPE_BOOST[input.type] +
    (input.inBoth ? RANK_WEIGHTS.both : 0);
  return Math.round(score * 10_000) / 10_000;
}
