import pg from 'pg';
import env from './env';

const { Pool } = pg;
let pool: pg.Pool | undefined;
let available = false;

export function databaseConfigured() {
  return Boolean(env.DATABASE_URL);
}

/**
 * Configuration only tells us that a database URL exists. Training routes need
 * a database whose migrations completed during the current process startup.
 */
export function databaseAvailable() {
  return available;
}

export function setDatabaseAvailable(value: boolean) {
  available = value;
}

export function databasePool() {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  pool ??= new Pool({ connectionString: env.DATABASE_URL });
  return pool;
}
