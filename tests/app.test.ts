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
]) {
  process.env[key] = 'test';
}
process.env.BAGTAG_ENDPOINT = 'https://example.test/bag-tags';
process.env.OFFICIAL_URL = 'https://example.test';
process.env.RATING_URL = 'https://example.test/ratings';
process.env.METRIX_URL = 'https://example.test/metrix';

const { default: app } = await import('../src/app');

const httpTestOptions = process.env.CI
  ? undefined
  : { skip: 'HTTP listeners are restricted in the local sandbox; CI runs these tests.' };

test(
  'health endpoint returns status, security headers, and request ID',
  httpTestOptions,
  async () => {
    const response = await request(app).get('/health').set('x-request-id', 'http-test');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.headers['x-request-id'], 'http-test');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers.ratelimit ?? '', /300/);
  },
);

test('unknown routes return the standard error shape', httpTestOptions, async () => {
  const response = await request(app).get('/does-not-exist').set('x-request-id', 'missing-test');

  assert.equal(response.status, 404);
  assert.equal(response.headers['x-request-id'], 'missing-test');
});
