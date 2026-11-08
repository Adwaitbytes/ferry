import { applyMigrations } from '../src/migrate.js';
import { loadMigrations } from '../src/migrations-fs.js';
import { neonSqlClient } from '../src/neon.js';

// Runs with the migrate role's connection string (X-DB-2), never the app role's.
const url = process.env['DATABASE_MIGRATE_URL'] ?? process.env['DATABASE_URL'];
if (!url) {
  console.error('Set DATABASE_MIGRATE_URL (or DATABASE_URL) to run migrations.');
  process.exit(1);
}
const applied = await applyMigrations(neonSqlClient(url), await loadMigrations());
console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Schema is up to date.');
