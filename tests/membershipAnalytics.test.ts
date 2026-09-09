import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import type Stripe from 'stripe';

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
process.env.DATABASE_URL = 'postgres://localhost/test';
process.env.UMAMI_SEND_URL = 'https://analytics.example.test/api/send';
process.env.UMAMI_WEBSITE_ID = 'd9c3d338-8335-4c11-b90c-d326ffc91854';
process.env.UMAMI_HOSTNAME = 'example.test';
process.env.STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS = 'plink_member';

const { membershipSession, trackMembershipConversion } = await import(
  '../src/services/membershipAnalyticsService'
);
const { databasePool, setDatabaseAvailable } = await import('../src/database');

function event(type = 'checkout.session.completed', overrides = {}) {
  return {
    type,
    data: {
      object: {
        id: 'cs_test',
        mode: 'subscription',
        payment_status: 'paid',
        payment_link: 'plink_member',
        amount_total: 3000,
        currency: 'eur',
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

test('only paid membership checkouts qualify, including delayed confirmations', () => {
  assert.ok(membershipSession(event(), ['plink_member']));
  assert.ok(membershipSession(event('checkout.session.async_payment_succeeded'), ['plink_member']));
  assert.ok(
    membershipSession(
      event('checkout.session.completed', { payment_link: { id: 'plink_member' } }),
      ['plink_member'],
    ),
  );
  for (const candidate of [
    event('invoice.paid'),
    event('payment_intent.succeeded'),
    event('checkout.session.async_payment_failed'),
    event('checkout.session.completed', { payment_status: 'unpaid' }),
    event('checkout.session.completed', { payment_status: 'no_payment_required' }),
    event('checkout.session.completed', { mode: 'payment' }),
    event('checkout.session.completed', { payment_link: 'plink_donation' }),
    event('checkout.session.completed', { payment_link: null }),
  ])
    assert.equal(membershipSession(candidate, ['plink_member']), null);
});

test('delivery retries failures and suppresses subsequent events for the same checkout', async (t) => {
  let delivered = false;
  let pending = false;
  let attempts = 0;
  let released = 0;
  const client = {
    async query(sql: string) {
      if (sql === 'begin') pending = delivered;
      if (sql.startsWith('select delivered_at'))
        return { rows: [{ delivered_at: pending ? new Date() : null }] };
      if (sql.startsWith('update membership_conversions')) pending = true;
      if (sql === 'commit') delivered = pending;
      return { rows: [] };
    },
    release() {
      released++;
    },
  };
  t.mock.method(databasePool(), 'connect', async () => client);
  t.mock.method(
    axios,
    'post',
    async (_url: string, body: { payload: { name: string; data: object } }) => {
      attempts++;
      assert.equal(body.payload.name, 'membership_completed');
      assert.deepEqual(body.payload.data, {
        source: 'stripe_webhook',
        payment_link: 'plink_member',
        amount_minor: 3000,
        currency: 'eur',
      });
      if (attempts === 1) throw new Error('Umami unavailable');
      return { status: 200 };
    },
  );
  setDatabaseAvailable(false);
  await assert.rejects(trackMembershipConversion(event()), /database unavailable/);
  setDatabaseAvailable(true);
  await assert.rejects(trackMembershipConversion(event()), /Umami unavailable/);
  assert.equal(delivered, false);
  await trackMembershipConversion(event());
  await trackMembershipConversion(event());
  await trackMembershipConversion(event('checkout.session.async_payment_succeeded'));
  assert.equal(attempts, 2);
  assert.equal(delivered, true);
  assert.equal(released, 4);
});
