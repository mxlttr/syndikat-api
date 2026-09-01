import app from './app';
import { databaseConfigured, databasePool, setDatabaseAvailable } from './database';
import env from './env';
import { runDatabaseMigrations } from './migrations';

const PORT = env.PORT || 8080;

export interface DatabaseStartupDependencies {
  configured: () => boolean;
  runMigrations: () => Promise<void>;
  setAvailable: (available: boolean) => void;
  nodeEnv: string;
  warn: (message: string, error: unknown) => void;
}

const databaseStartupDependencies: DatabaseStartupDependencies = {
  configured: databaseConfigured,
  runMigrations: () => runDatabaseMigrations(databasePool()),
  setAvailable: setDatabaseAvailable,
  nodeEnv: env.NODE_ENV,
  warn: console.warn,
};

export async function prepareDatabaseForStartup(
  dependencies: DatabaseStartupDependencies = databaseStartupDependencies,
) {
  dependencies.setAvailable(false);
  if (!dependencies.configured()) return false;

  try {
    await dependencies.runMigrations();
    dependencies.setAvailable(true);
    return true;
  } catch (error) {
    if (dependencies.nodeEnv !== 'development') throw error;
    dependencies.warn('⚠️ Database unavailable; starting API without training signups.', error);
    return false;
  }
}

async function start() {
  await prepareDatabaseForStartup();
  app.listen(PORT, () =>
    // eslint-disable-next-line no-console
    console.log(`🥏 API running at http://localhost:${PORT}`),
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
