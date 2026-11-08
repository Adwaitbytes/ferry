import { CARD_ID_RE } from './constants.js';
import { sha256Hex } from './hash.js';
import type { Card, PayStore } from './store.js';

export interface GuardLimits {
  /** X-GATE-4: more than this many 404s per IP per window returns 429. */
  notFoundPerIp: number;
  notFoundWindowMs: number;
  requestsPerIp: number;
  requestsPerIpWindowMs: number;
  requestsGlobal: number;
  requestsGlobalWindowMs: number;
}

export const DEFAULT_GUARD_LIMITS: GuardLimits = {
  notFoundPerIp: 20,
  notFoundWindowMs: 10 * 60_000,
  requestsPerIp: 60,
  requestsPerIpWindowMs: 60_000,
  requestsGlobal: 3000,
  requestsGlobalWindowMs: 60_000,
};

export type CardResolution =
  | { kind: 'invalid' }
  | { kind: 'not_found' }
  | { kind: 'limited'; retryAfterS: number }
  | { kind: 'card'; card: Card };

function retryAfter(windowMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((windowMs - (nowMs % windowMs)) / 1000));
}

/**
 * Gate abuse controls in one place so every route applies them the same way. Rate keys are
 * SHA-256 of the client IP: Neon never stores a raw IP.
 */
export class GateGuard {
  constructor(
    private readonly store: PayStore,
    private readonly limits: GuardLimits = DEFAULT_GUARD_LIMITS,
  ) {}

  static isCardId(value: string): boolean {
    return CARD_ID_RE.test(value);
  }

  /** Per-IP then global fixed-window limits. Returns seconds to wait, or null when allowed. */
  async limitRequest(ip: string, nowMs: number): Promise<number | null> {
    const { requestsPerIp, requestsPerIpWindowMs, requestsGlobal, requestsGlobalWindowMs } = this.limits;
    const ipHits = await this.store.hitRateBucket(`ip:${await sha256Hex(ip)}`, requestsPerIpWindowMs, nowMs);
    if (ipHits > requestsPerIp) return retryAfter(requestsPerIpWindowMs, nowMs);
    const globalHits = await this.store.hitRateBucket(`global:${'0'.repeat(64)}`, requestsGlobalWindowMs, nowMs);
    if (globalHits > requestsGlobal) return retryAfter(requestsGlobalWindowMs, nowMs);
    return null;
  }

  /**
   * Format first (no database access for a malformed id, RT-53), then one lookup. Unknown,
   * killed and disabled cards all come back as `not_found` so callers cannot tell them apart.
   */
  async resolveCard(rawId: string, ip: string, nowMs: number): Promise<CardResolution> {
    if (!GateGuard.isCardId(rawId)) return { kind: 'invalid' };
    const card = await this.store.getServableCard(rawId);
    if (card) return { kind: 'card', card };
    const misses = await this.store.hitRateBucket(`nf:${await sha256Hex(ip)}`, this.limits.notFoundWindowMs, nowMs);
    if (misses > this.limits.notFoundPerIp) return { kind: 'limited', retryAfterS: retryAfter(this.limits.notFoundWindowMs, nowMs) };
    return { kind: 'not_found' };
  }

  /** Daily cap is checked before a challenge is issued, so no agent pays for a capped card. */
  async underDailyCap(card: Card, nowMs: number): Promise<boolean> {
    return (await this.store.getDailyCount(card.id, nowMs)) < card.dailyCap;
  }
}
