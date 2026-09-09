import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const MIGRATION_LOCK_ID = 913700421;

export async function runDatabaseMigrations(pool: Pool) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockAcquired = true;
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    for (const directory of ['training', 'analytics']) {
      const directoryPath = path.join(root, directory);
      const files = (await readdir(directoryPath)).filter((file) => file.endsWith('.sql')).sort();
      for (const file of files) {
        const name = `${directory}/${file}`;
        const applied = await client.query('select 1 from schema_migrations where name = $1', [
          name,
        ]);
        if (applied.rowCount) continue;
        try {
          await client.query('begin');
          await client.query(await readFile(path.join(directoryPath, file), 'utf8'));
          await client.query('insert into schema_migrations (name) values ($1)', [name]);
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      }
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      }
    } finally {
      client.release();
    }
  }
}
