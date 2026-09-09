import axios from 'axios';
import express, { Router } from 'express';
import Stripe from 'stripe';
import env from '../env';
import { trackMembershipConversion } from '../services/membershipAnalyticsService';

const router = Router();

const endpointSecret = env.STRIPE_WEBHOOK_SECRET;
const stripe = new Stripe(env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20',
});

router.post('/', express.raw({ type: 'application/json' }), async (request, response) => {
  const sig = request.headers['stripe-signature'];
  if (!sig || !endpointSecret) {
    response.status(400).end();
    return;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
  } catch (err) {
    console.error('err:', err);
    response.status(400).end();
    return;
  }

  try {
    await trackMembershipConversion(event);
  } catch {
    console.error('Membership analytics delivery failed; Stripe should retry');
    response.sendStatus(503);
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      break;
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      triggerDiscordNotification(intent);
      break;
    }
    default:
      console.warn('Unhandled event type:', event.type);
  }

  response.sendStatus(200);
});

async function triggerDiscordNotification(intent: Stripe.PaymentIntent) {
  const url = env.DISCORD_WEBHOOK_URL;
  const channelId = env.DISCORD_CHANNEL_ID;
  if (!url || !channelId) return;

  const data = {
    content: `New payment over ${intent.amount / 100} ${intent.currency.toUpperCase()} received: Check Stripe for details: https://dashboard.stripe.com/payments/${intent.id}`,
    channel_id: channelId,
  };

  try {
    await axios.post(url, data);
  } catch (error) {
    console.error(error);
  }
}

export default router;
