import type { Request } from 'express';
import env from '../env';
import { postJson } from '../http';

export const ANALYTICS_OPT_OUT_COOKIE = 'syndikat_analytics_disabled';
export const ANALYTICS_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function assertAnalyticsAccepted(response: unknown) {
  if (response && typeof response === 'object' && 'beep' in response && response.beep === 'boop') {
    throw new Error('Umami rejected analytics event as bot traffic');
  }
}

export function analyticsOptedOut(request: Pick<Request, 'headers'>) {
  return (
    request.headers.cookie
      ?.split(';')
      .some((cookie) => cookie.trim() === `${ANALYTICS_OPT_OUT_COOKIE}=1`) ?? false
  );
}

async function trackEvent(
  name: string,
  url: string,
  data: Record<string, unknown>,
  send: typeof postJson,
): Promise<boolean> {
  if (!env.UMAMI_SEND_URL || !env.UMAMI_WEBSITE_ID || !env.UMAMI_HOSTNAME) return false;
  const response = await send(
    env.UMAMI_SEND_URL,
    {
      type: 'event',
      payload: {
        website: env.UMAMI_WEBSITE_ID,
        hostname: env.UMAMI_HOSTNAME,
        url,
        name,
        data,
      },
    },
    { headers: { 'User-Agent': ANALYTICS_USER_AGENT } },
  );
  assertAnalyticsAccepted(response);
  return true;
}

export function trackProductClick(
  shop: string,
  destination: URL,
  send: typeof postJson = postJson,
) {
  const path = destination.pathname;
  return trackEvent('product_click', path, { shop, path }, send);
}

export function trackProductSearch(query: string, send: typeof postJson = postJson) {
  return trackEvent('product_search', '/products/search-stream', { query }, send);
}

export function trackProductSearchCompleted(
  query: string,
  productCount: number,
  send: typeof postJson = postJson,
) {
  return trackEvent(
    'product_search_completed',
    '/products/search-stream',
    { query, product_count: productCount },
    send,
  );
}

export function trackProductSearchNoResults(query: string, send: typeof postJson = postJson) {
  return trackEvent('product_search_no_results', '/products/search-stream', { query }, send);
}

export function trackRatingsEvent(
  name: string,
  data: Record<string, unknown> = {},
  send: typeof postJson = postJson,
) {
  return trackEvent(name, '/ratings', data, send);
}

export function trackPlayerLoaded(gtNumber: number, send: typeof postJson = postJson) {
  return trackEvent('player_loaded', `/players/${gtNumber}`, { gt_number: gtNumber }, send);
}

export function trackTrainingSignup(send: typeof postJson = postJson) {
  return trackEvent('training_signup_completed', '/training/participants', {}, send);
}
