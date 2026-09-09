import axios from 'axios';
import type Stripe from 'stripe';
import { databaseAvailable, databasePool } from '../database';
import env from '../env';

export function membershipSession(event: Stripe.Event, allowedLinks: string[]) {
  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded'
  )
    return null;

  const session = event.data.object as Stripe.Checkout.Session;
  const link =
    typeof session.payment_link === 'string' ? session.payment_link : session.payment_link?.id;
  if (
    session.payment_status !== 'paid' ||
    session.mode !== 'subscription' ||
    !link ||
    !allowedLinks.includes(link)
  )
    return null;
  return session;
}

export async function trackMembershipConversion(event: Stripe.Event) {
  if (!env.UMAMI_SEND_URL) return;
  const session = membershipSession(
    event,
    (env.STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS ?? '').split(',').map((id) => id.trim()),
  );
  if (!session) return;
  if (!databaseAvailable()) throw new Error('Membership analytics database unavailable');

  const client = await databasePool().connect();
  try {
    await client.query('begin');
    // The unique key and row lock serialize concurrent deliveries for this checkout.
    await client.query(
      'insert into membership_conversions (checkout_session_id) values ($1) on conflict do nothing',
      [session.id],
    );
    const result = await client.query(
      'select delivered_at from membership_conversions where checkout_session_id = $1 for update',
      [session.id],
    );
    if (!result.rows[0].delivered_at) {
      await axios.post(
        env.UMAMI_SEND_URL,
        {
          type: 'event',
          payload: {
            website: env.UMAMI_WEBSITE_ID,
            hostname: env.UMAMI_HOSTNAME,
            url: '/register/',
            name: 'membership_completed',
            data: {
              source: 'stripe_webhook',
              payment_link:
                typeof session.payment_link === 'string'
                  ? session.payment_link
                  : session.payment_link?.id,
              amount_minor: session.amount_total,
              currency: session.currency,
            },
          },
        },
        { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Server)' } },
      );
      await client.query(
        'update membership_conversions set delivered_at = now() where checkout_session_id = $1',
        [session.id],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
