import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';

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
delete process.env.UMAMI_SEND_URL;
process.env.RATING_URL = 'https://example.test/ratings';
process.env.OFFICIAL_URL = 'https://example.test';
process.env.BAGTAG_ENDPOINT = 'https://example.test/bag-tags';
process.env.METRIX_URL = 'https://example.test/metrix';

const { outboundUrl, resolveOutboundDestination } = await import('../src/services/outboundService');
const { analyticsOptedOut } = await import('../src/services/analyticsService');
const { default: shops } = await import('../src/shopList');
const { default: app } = await import('../src/app');
test('shop IDs are unique three-letter codes', () => {
  const ids = shops.map((shop) => shop.id);
  assert.ok(ids.every((id) => /^[a-z]{3}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('outbound URLs contain the readable product path and preserve its query', () => {
  assert.equal(
    outboundUrl(
      'itc',
      { url: 'https://www.inside-the-circle.de/products/flight?variant=42' },
      'http://localhost:8080',
    ),
    'http://localhost:8080/out/itc/products/flight?variant=42',
  );
});

test('destination resolution validates configured shop and preserves product query', () => {
  const product = { path: '/Disc.html?variant=42&ref=merchant', title: 'Disc' };
  const destination = resolveOutboundDestination('crl', product);
  assert.equal(destination?.hostname, 'www.discgolf-shop.de');
  assert.equal(destination?.searchParams.get('variant'), '42');
  assert.equal(destination?.searchParams.get('ref'), 'syndikat.golf');
  assert.equal(
    resolveOutboundDestination('crl', { path: '/Disc.html' })?.hostname,
    'www.discgolf-shop.de',
  );
  assert.equal(resolveOutboundDestination('unknown', product), null);
  const discgolfStoreProduct = resolveOutboundDestination('dgs', {
    path: '/Disc.html?variant=7',
  });
  assert.equal(discgolfStoreProduct?.searchParams.get('variant'), '7');
  assert.equal(discgolfStoreProduct?.searchParams.has('af'), false);
  assert.equal(discgolfStoreProduct?.searchParams.get('ref'), 'syndikat.golf');
  assert.equal(resolveOutboundDestination('crl', { path: '//attacker.example/steal' }), null);
  assert.equal(
    resolveOutboundDestination('crl', { path: 'http://www.discgolf-shop.de/path' }),
    null,
  );
  assert.equal(resolveOutboundDestination('crl', { path: '/\\shop.discgolf-shop.de/path' }), null);
});

test('analytics opt-out is enabled only by the exact opt-out cookie value', () => {
  assert.equal(
    analyticsOptedOut({ headers: { cookie: 'other=1; syndikat_analytics_disabled=1' } }),
    true,
  );
  assert.equal(analyticsOptedOut({ headers: { cookie: 'syndikat_analytics_disabled=0' } }), false);
  assert.equal(analyticsOptedOut({ headers: {} }), false);
});

test('outbound endpoint redirects valid tokens and rejects invalid links', async () => {
  const response = await request(app).get('/out/crl/Disc.html?variant=42').expect(302);
  assert.equal(
    response.headers.location,
    'https://www.discgolf-shop.de/Disc.html?variant=42&ref=syndikat.golf',
  );
  await request(app).get('/out/xxx/Disc.html').expect(404);
  await request(app).get('/out/crl/%2F%2Fevil.example/steal').expect(400);
});
