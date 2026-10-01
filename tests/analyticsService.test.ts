import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { postJson } from '../src/http';

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
])
  process.env[key] = 'test';
process.env.RATING_URL = 'https://example.test/ratings';
process.env.UMAMI_SEND_URL = 'https://analytics.example.test/api/send';
process.env.UMAMI_WEBSITE_ID = 'd9c3d338-8335-4c11-b90c-d326ffc91854';
process.env.UMAMI_HOSTNAME = 'example.test';
process.env.STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS = 'test';
process.env.DATABASE_URL = 'https://example.test/database';

const {
  analyticsOptedOut,
  trackProductClick,
  trackProductSearch,
  trackProductSearchCompleted,
  trackProductSearchNoResults,
  trackRatingsEvent,
  trackPlayerLoaded,
  trackTrainingSignup,
  assertAnalyticsAccepted,
} = await import('../src/services/analyticsService');
const env = (await import('../src/env')).default;

function sender(events: unknown[]) {
  return (async (_url: string, body: unknown) => {
    events.push(body);
    return { status: 200 };
  }) as typeof postJson;
}

test('analytics helpers send the expected Umami event payloads', async () => {
  const events: unknown[] = [];
  const send = sender(events);

  assert.equal(
    await trackProductClick('itc', new URL('https://shop.test/products/disc'), send),
    true,
  );
  assert.equal(await trackProductSearch('Buzzz', send), true);
  assert.equal(await trackProductSearchCompleted('Buzzz', 3, send), true);
  assert.equal(await trackProductSearchNoResults('Nothing', send), true);
  assert.equal(await trackRatingsEvent('ratings_no_results', { query: 'x' }, send), true);
  assert.equal(await trackPlayerLoaded(12345, send), true);
  assert.equal(await trackTrainingSignup(send), true);

  assert.deepEqual(
    (events as Array<{ payload: { name: string; data: unknown } }>).map((event) => ({
      name: event.payload.name,
      data: event.payload.data,
    })),
    [
      { name: 'product_click', data: { shop: 'itc', path: '/products/disc' } },
      { name: 'product_search', data: { query: 'Buzzz' } },
      { name: 'product_search_completed', data: { query: 'Buzzz', product_count: 3 } },
      { name: 'product_search_no_results', data: { query: 'Nothing' } },
      { name: 'ratings_no_results', data: { query: 'x' } },
      { name: 'player_loaded', data: { gt_number: 12345 } },
      { name: 'training_signup_completed', data: {} },
    ],
  );
});

test('analytics opt-out recognizes only the enabled cookie', () => {
  assert.equal(
    analyticsOptedOut({ headers: { cookie: 'foo=1; syndikat_analytics_disabled=1' } }),
    true,
  );
  assert.equal(analyticsOptedOut({ headers: { cookie: 'syndikat_analytics_disabled=0' } }), false);
  assert.equal(analyticsOptedOut({ headers: {} }), false);
});

test('analytics helpers report disabled configuration and propagate delivery failures', async () => {
  const send = sender([]);
  const original = {
    url: env.UMAMI_SEND_URL,
    website: env.UMAMI_WEBSITE_ID,
    hostname: env.UMAMI_HOSTNAME,
  };
  env.UMAMI_SEND_URL = undefined;
  assert.equal(await trackProductSearch('query', send), false);
  env.UMAMI_SEND_URL = original.url;

  const failingSend = (async () => {
    throw new Error('Umami unavailable');
  }) as typeof postJson;
  await assert.rejects(trackProductSearch('query', failingSend), /Umami unavailable/);
  env.UMAMI_WEBSITE_ID = original.website;
  env.UMAMI_HOSTNAME = original.hostname;
});

test('analytics helpers reject Umami bot-detection responses', () => {
  assert.throws(() => assertAnalyticsAccepted({ beep: 'boop' }), /bot traffic/);
  assert.doesNotThrow(() => assertAnalyticsAccepted({ cache: 'accepted' }));
});
