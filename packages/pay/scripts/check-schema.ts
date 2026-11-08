import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../src/migrate.js';
import { loadMigrations } from '../src/migrations-fs.js';
import { findMemoryTextColumns } from '../src/schema-check.js';
import { pgliteSqlClient } from '../src/testing.js';

// X-DB-1 for CI: apply every migration to an empty Postgres and fail if any column could hold
// memory text. Runs offline, so it gates pull requests without database credentials.
const db = new PGlite();
const sql = pgliteSqlClient(db);
await applyMigrations(sql, await loadMigrations());
const violations = await findMemoryTextColumns(sql);
await db.close();
if (violations.length > 0) {
  for (const v of violations) console.error(`${v.column}: ${v.problem}`);
  process.exit(1);
}
console.log('Schema check passed: no column can hold memory text.');
