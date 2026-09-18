import Redis from 'ioredis';
import env from './env';
import { logger } from './logger';

// Create Redis client from HEROKU REDIS_URL
// If REDIS_URL is not set, defaults to localhost

const isProduction = env.NODE_ENV === 'production';
if (isProduction && !env.REDIS_URL) {
  throw new Error('REDIS_URL not configured for production');
}

// Redis is a production cache. Keep local development independent from any
// inherited REDIS_URL (for example, one exported by a deployment shell).
const redis =
  isProduction && env.REDIS_URL
    ? new Redis(
        env.REDIS_URL as string,
        env.REDIS_URL.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {},
      )
    : null;

const DEFAULT_EXPIRY = Number(env.CACHE_EXPIRY) || 3600;

/**
 * Best-effort cache read: Redis failures intentionally degrade to a miss so
 * scraper-backed endpoints remain available without a cache connection.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    if (!val) return null;
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

/** Writes are best-effort for the same reason as reads; callers must not rely on persistence. */
export async function setCache<T>(
  key: string,
  value: T,
  expiry: number = DEFAULT_EXPIRY,
): Promise<void> {
  if (!redis) return;
  try {
    // 'EX' sets expiry in seconds
    await redis.set(key, JSON.stringify(value), 'EX', expiry);
  } catch {
    // Swallow errors like Memcached version
  }
}

let redisAvailable = false;
if (redis) {
  redis.on('connect', () => {
    redisAvailable = true;
    logger.info('✅ Redis connected');
  });

  redis.on('error', (err) => {
    redisAvailable = false;
    logger.warn('⚠️ Redis unavailable', { error: err.message });
  });

  redis.on('end', () => {
    redisAvailable = false;
    logger.warn('⚠️ Redis connection closed');
  });
}

export function redisStatus() {
  return redisAvailable;
}

export async function closeCache() {
  if (!redis) return;
  await redis.quit();
}
