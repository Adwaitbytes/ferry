import type { SqlClient } from './sql.js';

/** X-DB-1: column names that would suggest memory text landed in Neon. */
const BANNED_NAMES = /(^|_)(text|fact|facts|quote|quotes|content|memory|memories|body|query|prompt|message|q)$/;

/**
 * Unbounded string columns allowed in the schema. Each is an identifier with a format CHECK,
 * not free text. Anything else that can hold a string must be a short bounded varchar.
 */
const ID_COLUMNS = new Set([
  'cards.id',
  'cards.owner_address',
  'cards.public_account_id',
  'cards.allowed_agents',
  'challenges.id',
  'challenges.card_id',
  'challenges.recipient',
  'payments.receipt_id',
  'payments.digest',
  'payments.challenge_id',
  'payments.card_id',
  'payments.payer',
  'payments.query_sha256',
  'daily_counters.card_id',
  'siws_nonces.nonce',
]);
const MAX_LABEL_CHARS = 80;

export interface SchemaViolation {
  column: string;
  problem: 'banned_name' | 'unbounded_text' | 'label_too_long';
}

/** Returns every column that could hold memory text. An empty list means the schema is clean. */
export async function findMemoryTextColumns(sql: SqlClient): Promise<SchemaViolation[]> {
  const columns = await sql.query<{ table_name: string; column_name: string; data_type: string; max_len: number | null }>(
    `SELECT table_name, column_name, data_type, character_maximum_length AS max_len
       FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, column_name`,
  );
  const violations: SchemaViolation[] = [];
  for (const col of columns) {
    const column = `${col.table_name}.${col.column_name}`;
    if (BANNED_NAMES.test(col.column_name)) violations.push({ column, problem: 'banned_name' });
    const isString = col.data_type === 'text' || col.data_type === 'ARRAY' || col.data_type === 'character varying' || col.data_type === 'character';
    if (!isString || ID_COLUMNS.has(column)) continue;
    if (col.max_len === null) violations.push({ column, problem: 'unbounded_text' });
    else if (col.max_len > MAX_LABEL_CHARS) violations.push({ column, problem: 'label_too_long' });
  }
  return violations;
}
