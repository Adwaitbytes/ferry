import type { SqlClient } from './sql.js';

export interface Migration {
  name: string;
  sql: string;
}

const MIGRATION_NAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Splits a migration into statements. Neon over HTTP runs one statement per request, so the
 * runner cannot send the file whole. Migration files are ours and contain no function bodies,
 * which is what makes a plain `;` split safe here.
 */
export function splitStatements(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Applies pending migrations in name order and records each in `schema_migrations`. */
export async function applyMigrations(sql: SqlClient, migrations: readonly Migration[]): Promise<string[]> {
  await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (name varchar(80) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await sql.query<{ name: string }>('SELECT name FROM schema_migrations')).map((row) => row.name));
  const applied: string[] = [];
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!MIGRATION_NAME_RE.test(migration.name)) throw new Error(`migration name not allowed: ${migration.name}`);
    if (done.has(migration.name)) continue;
    for (const statement of splitStatements(migration.sql)) await sql.query(statement);
    await sql.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    applied.push(migration.name);
  }
  return applied;
}
