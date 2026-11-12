import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const key of [
  'NODE_ENV',
  'ALLOWED_ORIGIN',
  'BAGTAG_ENDPOINT',
  'CACHE_EXPIRY',
  'DISCORD_CHANNEL_ID',
  'DISCORD_WEBHOOK_URL',
  'METRIX_URL',
  'OPENROUTESERVICE_API_KEY',
  'OFFICIAL_URL',
  'RATING_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TOURNAMENTS_API_SECRET',
  'TOURNAMENTS_API_TOKEN',
]) {
  process.env[key] = 'test';
}

const { getProductFeed, ProductFeedUnavailableError } = await import(
  '../src/scrapers/storesScraper'
);
const { http } = await import('../src/http');
const { logger } = await import('../src/logger');

const product = {
  title: 'Test disc',
  price: 2000,
  store: 'test',
  url: 'https://example.test/products/test-disc',
  stockStatus: 'available' as const,
  crawledAt: '2026-11-12T00:00:00.000Z',
};

function cache() {
  const values = new Map<string, unknown>();
  const writes: { key: string; expiry?: number }[] = [];
  return {
    values,
    writes,
    getCached: async (key: string) => values.get(key) ?? null,
    setCached: async (key: string, value: unknown, expiry?: number) => {
      values.set(key, value);
      writes.push({ key, expiry });
    },
  };
}

test('complete feed refresh is cached and reused', async () => {
  const stored = cache();
  let scrapes = 0;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => {
      scrapes += 1;
      return { products: [product], complete: true, successfulStores: 3, cooldownSeconds: 0 };
    },
  };

  assert.deepEqual(await getProductFeed(options), [product]);
  assert.deepEqual(await getProductFeed(options), [product]);
  assert.equal(scrapes, 1);
  assert.equal(stored.writes.length, 3);
  assert.equal(stored.writes[1].expiry, 24 * 60 * 60);
  assert.deepEqual(stored.writes[2], {
    key: 'product-feed-v2-all-failure-streak',
    expiry: 1,
  });
});

test('a successful empty feed is cached for the configured lifetime', async () => {
  const stored = cache();
  let scrapes = 0;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => {
      scrapes += 1;
      return { products: [], complete: true, successfulStores: 3, cooldownSeconds: 0 };
    },
  };

  assert.deepEqual(await getProductFeed(options), []);
  assert.deepEqual(await getProductFeed(options), []);
  assert.equal(scrapes, 1);
  assert.deepEqual(stored.writes[0], { key: 'product-feed-v2-all', expiry: undefined });
  assert.deepEqual(stored.values.get('product-feed-v2-all'), []);
});

test('simultaneous cache misses share one refresh', async () => {
  const stored = cache();
  let scrapes = 0;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => {
      scrapes += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { products: [product], complete: true, successfulStores: 3, cooldownSeconds: 0 };
    },
  };

  assert.deepEqual(await Promise.all([getProductFeed(options), getProductFeed(options)]), [
    [product],
    [product],
  ]);
  assert.equal(scrapes, 1);
});

test('a failed refresh serves the last complete feed and pauses new scrapes', async () => {
  const stored = cache();
  stored.values.set('product-feed-v2-all-last-good', [product]);
  let scrapes = 0;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => {
      scrapes += 1;
      return { products: [], complete: false, successfulStores: 0, cooldownSeconds: 120 };
    },
  };

  assert.deepEqual(await getProductFeed(options), [product]);
  assert.deepEqual(await getProductFeed(options), [product]);
  assert.equal(scrapes, 1);
  assert.deepEqual(stored.writes, [
    { key: 'product-feed-v2-all-failure-streak', expiry: 24 * 60 * 60 },
    { key: 'product-feed-v2-all-cooldown', expiry: 15 * 60 },
  ]);
});

test('a partial feed is used briefly when no complete feed exists', async () => {
  const stored = cache();
  let scrapes = 0;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => {
      scrapes += 1;
      return { products: [product], complete: false, successfulStores: 1, cooldownSeconds: 60 };
    },
  };

  assert.deepEqual(await getProductFeed(options), [product]);
  assert.deepEqual(await getProductFeed(options), [product]);
  assert.equal(scrapes, 1);
  assert.equal(stored.values.has('product-feed-v2-all'), false);
  assert.deepEqual(stored.writes, [
    { key: 'product-feed-v2-all-failure-streak', expiry: 24 * 60 * 60 },
    { key: 'product-feed-v2-all-cooldown', expiry: 15 * 60 },
    { key: 'product-feed-v2-all-partial', expiry: 15 * 60 },
  ]);
});

test('all failed stores without cached products return an error during cooldown', async () => {
  const stored = cache();
  let scrapes = 0;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => {
      scrapes += 1;
      return { products: [], complete: false, successfulStores: 0, cooldownSeconds: 60 };
    },
  };

  await assert.rejects(getProductFeed(options), ProductFeedUnavailableError);
  await assert.rejects(getProductFeed(options), ProductFeedUnavailableError);
  assert.equal(scrapes, 1);
  assert.equal(stored.values.has('product-feed-v2-all'), false);
});

test('failed refreshes back off exponentially and reset after success', async () => {
  const stored = cache();
  let complete = false;
  const options = {
    production: true,
    getCached: stored.getCached,
    setCached: stored.setCached,
    scrape: async () => ({
      products: [],
      complete,
      successfulStores: complete ? 3 : 0,
      cooldownSeconds: 0,
    }),
  };

  for (const expected of [900, 1800, 3600, 7200, 14400, 28800, 28800]) {
    await assert.rejects(getProductFeed(options), ProductFeedUnavailableError);
    assert.equal(stored.writes.at(-1)?.expiry, expected);
    stored.values.delete('product-feed-v2-all-cooldown');
  }

  complete = true;
  assert.deepEqual(await getProductFeed(options), []);
  assert.equal(stored.values.get('product-feed-v2-all-failure-streak'), 0);
});

test('Shopify 429 honors a longer Retry-After without immediate retries', async (t) => {
  const stored = cache();
  const requested: string[] = [];
  t.mock.method(logger, 'error', () => {});
  t.mock.method(logger, 'warn', () => {});
  t.mock.method(http, 'request', async (config: { url: string }) => {
    requested.push(config.url);
    if (config.url.includes('inside-the-circle')) {
      throw { response: { status: 429, headers: { 'retry-after': '3600' } } };
    }
    return { data: { products: [] } };
  });

  assert.deepEqual(
    await getProductFeed({
      production: true,
      getCached: stored.getCached,
      setCached: stored.setCached,
    }),
    [],
  );
  assert.equal(requested.length, 3);
  assert.deepEqual(stored.writes, [
    { key: 'product-feed-v2-all-failure-streak', expiry: 24 * 60 * 60 },
    { key: 'product-feed-v2-all-cooldown', expiry: 3600 },
    { key: 'product-feed-v2-all-partial', expiry: 3600 },
  ]);
});
