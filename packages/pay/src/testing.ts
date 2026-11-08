// Test and CI helper (exported as @ferry/pay/testing). Never imported by runtime code.
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from './migrate.js';
import { loadMigrations } from './migrations-fs.js';
import type { SqlClient } from './sql.js';

export function pgliteSqlClient(db: PGlite): SqlClient & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query<Row extends Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
      statements.push(text);
      return (await db.query<Row>(text, [...params])).rows;
    },
  };
}

/** A fresh, migrated, in-process Postgres. Real constraints, real ON CONFLICT semantics. */
export async function freshDatabase(): Promise<{ db: PGlite; sql: SqlClient & { statements: string[] } }> {
  const db = new PGlite();
  const sql = pgliteSqlClient(db);
  await applyMigrations(sql, await loadMigrations());
  sql.statements.length = 0;
  return { db, sql };
}
