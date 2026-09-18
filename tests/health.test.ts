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
process.env.BAGTAG_ENDPOINT = 'https://example.test/bag-tags';
process.env.OFFICIAL_URL = 'https://example.test';
process.env.RATING_URL = 'https://example.test/ratings';
process.env.METRIX_URL = 'https://example.test/metrix';

const { healthPayload } = await import('../src/routes/indexRouter');

test('health reports API and dependency status', () => {
  const body = healthPayload();
  assert.equal(body.status, 'ok');
  assert.equal(body.redis, 'down');
});
