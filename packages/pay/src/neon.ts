import { neon } from '@neondatabase/serverless';
import type { SqlClient } from './sql.js';

/** Neon over HTTP: one round trip per statement, no pool to exhaust on serverless (THREAT_MODEL 14). */
export function neonSqlClient(databaseUrl: string): SqlClient {
  const sql = neon(databaseUrl);
  return {
    async query<Row extends Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
      return (await sql.query(text, [...params])) as Row[];
    },
  };
}
