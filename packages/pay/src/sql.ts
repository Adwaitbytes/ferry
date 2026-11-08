/**
 * The only database surface packages/pay uses: one parameterized statement at a time. Neon
 * (HTTP) implements it in production and PGlite in tests, so the unique constraints that stop
 * replays are real Postgres constraints in both (REDTEAM 1: RT-41 may not mock the database).
 */
export interface SqlClient {
  query<Row extends Record<string, unknown>>(text: string, params?: readonly SqlParam[]): Promise<Row[]>;
}

export type SqlParam = string | number | boolean | null | readonly string[];
