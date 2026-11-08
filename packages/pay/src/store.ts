import type { SqlClient } from './sql.js';

export interface Card {
  id: string;
  /** Also the payment recipient: Ferry never custodies funds (PRD F8). */
  ownerAddress: string;
  publicAccountId: string;
  name: string;
  scopeLabel: string;
  priceMicros: bigint;
  dailyCap: number;
  allowedAgents: readonly string[];
  enabled: boolean;
  killed: boolean;
  createdAtMs: number;
}

export interface NewCard {
  id: string;
  ownerAddress: string;
  publicAccountId: string;
  name: string;
  scopeLabel: string;
  priceMicros: bigint;
  dailyCap: number;
  allowedAgents: readonly string[];
}

export interface CardPatch {
  name?: string;
  scopeLabel?: string;
  priceMicros?: bigint;
  dailyCap?: number;
  allowedAgents?: readonly string[];
  enabled?: boolean;
}

export interface StoredChallenge {
  id: string;
  cardId: string;
  priceMicros: bigint;
  recipient: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface PaymentRow {
  receiptId: string;
  digest: string;
  challengeId: string;
  cardId: string;
  payer: string;
  amountMicros: bigint;
  querySha256: string;
  dialect: 'mpp' | 'x402';
}

export interface EarningRow {
  receiptId: string;
  cardId: string;
  cardName: string;
  payer: string;
  querySha256: string;
  amountMicros: bigint;
  digest: string;
  createdAtMs: number;
}

export interface Earnings {
  payments: EarningRow[];
  totalMicros: bigint;
  todayMicros: bigint;
  count: number;
}

type CardRow = {
  id: string;
  owner_address: string;
  public_account_id: string;
  name: string;
  scope_label: string;
  price_micros: string;
  daily_cap: number;
  allowed_agents: string[];
  enabled: boolean;
  killed: boolean;
  created_ms: string;
};

const CARD_COLUMNS = `id, owner_address, public_account_id, name, scope_label, price_micros::text AS price_micros,
  daily_cap, allowed_agents, enabled, killed, (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms`;

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    ownerAddress: row.owner_address,
    publicAccountId: row.public_account_id,
    name: row.name,
    scopeLabel: row.scope_label,
    priceMicros: BigInt(row.price_micros),
    dailyCap: Number(row.daily_cap),
    allowedAgents: row.allowed_agents,
    enabled: row.enabled,
    killed: row.killed,
    createdAtMs: Number(row.created_ms),
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const dayOf = (ms: number): string => iso(ms).slice(0, 10);

/** Every Gate table access. Parameterized statements only (THREAT_MODEL 14). */
export class PayStore {
  constructor(private readonly sql: SqlClient) {}

  async getCard(id: string): Promise<Card | null> {
    const rows = await this.sql.query<CardRow>(`SELECT ${CARD_COLUMNS} FROM cards WHERE id = $1`, [id]);
    return rows[0] ? toCard(rows[0]) : null;
  }

  /** A card that can be paid for. Unknown, killed and disabled all return null (RT-54). */
  async getServableCard(id: string): Promise<Card | null> {
    const card = await this.getCard(id);
    return card && card.enabled && !card.killed ? card : null;
  }

  async listCardsByOwner(owner: string): Promise<Card[]> {
    const rows = await this.sql.query<CardRow>(`SELECT ${CARD_COLUMNS} FROM cards WHERE owner_address = $1 ORDER BY created_at DESC`, [owner]);
    return rows.map(toCard);
  }

  async createCard(card: NewCard): Promise<Card> {
    const rows = await this.sql.query<CardRow>(
      `INSERT INTO cards (id, owner_address, public_account_id, name, scope_label, price_micros, daily_cap, allowed_agents)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::text[]) RETURNING ${CARD_COLUMNS}`,
      [card.id, card.ownerAddress, card.publicAccountId, card.name, card.scopeLabel, card.priceMicros.toString(), card.dailyCap, card.allowedAgents],
    );
    const row = rows[0];
    if (!row) throw new Error('card insert returned no row');
    return toCard(row);
  }

  /** Owner is part of the WHERE clause so a session for another address updates nothing. */
  async updateCard(id: string, owner: string, patch: CardPatch): Promise<Card | null> {
    const rows = await this.sql.query<CardRow>(
      `UPDATE cards SET
         name = COALESCE($3, name),
         scope_label = COALESCE($4, scope_label),
         price_micros = COALESCE($5::bigint, price_micros),
         daily_cap = COALESCE($6, daily_cap),
         allowed_agents = COALESCE($7::text[], allowed_agents),
         enabled = COALESCE($8, enabled),
         updated_at = now()
       WHERE id = $1 AND owner_address = $2 AND NOT killed
       RETURNING ${CARD_COLUMNS}`,
      [
        id,
        owner,
        patch.name ?? null,
        patch.scopeLabel ?? null,
        patch.priceMicros === undefined ? null : patch.priceMicros.toString(),
        patch.dailyCap ?? null,
        patch.allowedAgents ?? null,
        patch.enabled ?? null,
      ],
    );
    return rows[0] ? toCard(rows[0]) : null;
  }

  /** The kill switch is one-way: a killed card id is never served again. */
  async killCard(id: string, owner: string): Promise<boolean> {
    const rows = await this.sql.query<{ id: string }>(
      'UPDATE cards SET killed = true, enabled = false, updated_at = now() WHERE id = $1 AND owner_address = $2 RETURNING id',
      [id, owner],
    );
    return rows.length === 1;
  }

  async insertChallenge(challenge: StoredChallenge): Promise<void> {
    await this.sql.query(
      `INSERT INTO challenges (id, card_id, price_micros, recipient, issued_at, expires_at)
       VALUES ($1, $2, $3::bigint, $4, $5::timestamptz, $6::timestamptz) ON CONFLICT (id) DO NOTHING`,
      [challenge.id, challenge.cardId, challenge.priceMicros.toString(), challenge.recipient, iso(challenge.issuedAtMs), iso(challenge.expiresAtMs)],
    );
  }

  async getChallenge(id: string): Promise<StoredChallenge | null> {
    const rows = await this.sql.query<{ id: string; card_id: string; price_micros: string; recipient: string; issued_ms: string; expires_ms: string }>(
      `SELECT id, card_id, price_micros::text AS price_micros, recipient,
              (extract(epoch FROM issued_at) * 1000)::bigint::text AS issued_ms,
              (extract(epoch FROM expires_at) * 1000)::bigint::text AS expires_ms
         FROM challenges WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      cardId: row.card_id,
      priceMicros: BigInt(row.price_micros),
      recipient: row.recipient,
      issuedAtMs: Number(row.issued_ms),
      expiresAtMs: Number(row.expires_ms),
    };
  }

  /** Advisory only: lets a replay fail fast before any chain read. The insert below decides. */
  async isDigestUsed(digest: string): Promise<boolean> {
    const rows = await this.sql.query<{ one: number }>('SELECT 1 AS one FROM payments WHERE digest = $1', [digest]);
    return rows.length > 0;
  }

  /**
   * The replay gate. One statement: a digest or a challenge that was already used makes the
   * insert a no-op and zero rows come back. Two racing requests cannot both get a row.
   */
  async commitPayment(row: PaymentRow): Promise<boolean> {
    const rows = await this.sql.query<{ receipt_id: string }>(
      `INSERT INTO payments (receipt_id, digest, challenge_id, card_id, payer, amount_micros, query_sha256, dialect)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8)
       ON CONFLICT DO NOTHING RETURNING receipt_id`,
      [row.receiptId, row.digest, row.challengeId, row.cardId, row.payer, row.amountMicros.toString(), row.querySha256, row.dialect],
    );
    return rows.length === 1;
  }

  async incrementDaily(cardId: string, nowMs: number): Promise<number> {
    const rows = await this.sql.query<{ paid_count: number }>(
      `INSERT INTO daily_counters (card_id, day, paid_count) VALUES ($1, $2::date, 1)
       ON CONFLICT (card_id, day) DO UPDATE SET paid_count = daily_counters.paid_count + 1
       RETURNING paid_count`,
      [cardId, dayOf(nowMs)],
    );
    return Number(rows[0]?.paid_count ?? 0);
  }

  async getDailyCount(cardId: string, nowMs: number): Promise<number> {
    const rows = await this.sql.query<{ paid_count: number }>('SELECT paid_count FROM daily_counters WHERE card_id = $1 AND day = $2::date', [
      cardId,
      dayOf(nowMs),
    ]);
    return Number(rows[0]?.paid_count ?? 0);
  }

  /** Fixed-window counter, incremented atomically. Returns the hit count including this one. */
  async hitRateBucket(bucketKey: string, windowMs: number, nowMs: number): Promise<number> {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const rows = await this.sql.query<{ hits: number }>(
      `INSERT INTO rate_buckets (bucket_key, window_start, hits) VALUES ($1, $2::timestamptz, 1)
       ON CONFLICT (bucket_key, window_start) DO UPDATE SET hits = rate_buckets.hits + 1
       RETURNING hits`,
      [bucketKey, iso(windowStart)],
    );
    return Number(rows[0]?.hits ?? 0);
  }

  async createNonce(nonce: string, expiresAtMs: number): Promise<void> {
    await this.sql.query('INSERT INTO siws_nonces (nonce, expires_at) VALUES ($1, $2::timestamptz)', [nonce, iso(expiresAtMs)]);
  }

  /** Single use: only the first caller flips consumed_at and gets a row back. */
  async consumeNonce(nonce: string, nowMs: number): Promise<boolean> {
    const rows = await this.sql.query<{ nonce: string }>(
      `UPDATE siws_nonces SET consumed_at = $2::timestamptz
        WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > $2::timestamptz RETURNING nonce`,
      [nonce, iso(nowMs)],
    );
    return rows.length === 1;
  }

  async earnings(owner: string, nowMs: number, limit: number): Promise<Earnings> {
    const rows = await this.sql.query<{
      receipt_id: string;
      card_id: string;
      card_name: string;
      payer: string;
      query_sha256: string;
      amount_micros: string;
      digest: string;
      created_ms: string;
    }>(
      `SELECT p.receipt_id, p.card_id, c.name AS card_name, p.payer, p.query_sha256, p.amount_micros::text AS amount_micros,
              p.digest, (extract(epoch FROM p.created_at) * 1000)::bigint::text AS created_ms
         FROM payments p JOIN cards c ON c.id = p.card_id
        WHERE c.owner_address = $1
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [owner, limit],
    );
    const totals = await this.sql.query<{ total: string; today: string; n: string }>(
      `SELECT COALESCE(sum(p.amount_micros), 0)::text AS total,
              COALESCE(sum(p.amount_micros) FILTER (WHERE p.created_at >= $2::date), 0)::text AS today,
              count(*)::text AS n
         FROM payments p JOIN cards c ON c.id = p.card_id
        WHERE c.owner_address = $1`,
      [owner, dayOf(nowMs)],
    );
    const total = totals[0];
    return {
      payments: rows.map((row) => ({
        receiptId: row.receipt_id,
        cardId: row.card_id,
        cardName: row.card_name,
        payer: row.payer,
        querySha256: row.query_sha256.trim(),
        amountMicros: BigInt(row.amount_micros),
        digest: row.digest,
        createdAtMs: Number(row.created_ms),
      })),
      totalMicros: BigInt(total?.total ?? '0'),
      todayMicros: BigInt(total?.today ?? '0'),
      count: Number(total?.n ?? '0'),
    };
  }

  /** Drops expired challenges, nonces and rate windows. Payments are never pruned. */
  async prune(nowMs: number): Promise<void> {
    const cutoff = iso(nowMs - 24 * 60 * 60_000);
    await this.sql.query('DELETE FROM rate_buckets WHERE window_start < $1::timestamptz', [cutoff]);
    await this.sql.query('DELETE FROM siws_nonces WHERE expires_at < $1::timestamptz', [cutoff]);
    await this.sql.query(
      'DELETE FROM challenges ch WHERE ch.expires_at < $1::timestamptz AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.challenge_id = ch.id)',
      [cutoff],
    );
  }
}
