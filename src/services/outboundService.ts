import shops, { outboundReferralParams } from '../shopList';

type Shop = (typeof shops)[number] & {
  id: string;
};

export interface OutboundPayload {
  path: string;
}

const configuredShops = shops as Shop[];

export function getOutboundShop(shopId: string) {
  return configuredShops.find((shop) => shop.id === shopId) ?? null;
}

export function resolveOutboundDestination(shopId: string, payload: OutboundPayload): URL | null {
  const shop = getOutboundShop(shopId);
  if (!shop) return null;
  try {
    if (
      !payload.path.startsWith('/') ||
      payload.path.startsWith('//') ||
      payload.path.includes('\\')
    )
      return null;
    const configuredUrl = new URL(shop.url);
    if (configuredUrl.protocol !== 'https:') return null;
    const shopOrigin = configuredUrl.origin;
    const destination = new URL(payload.path, shopOrigin);
    if (destination.origin !== shopOrigin) return null;
    for (const [key, value] of Object.entries(outboundReferralParams)) {
      destination.searchParams.set(key, value);
    }
    return destination;
  } catch {
    return null;
  }
}

export function outboundUrl(shopId: string, product: { url: string }, origin: string) {
  const productUrl = new URL(product.url);
  return `${origin.replace(/\/$/, '')}/out/${shopId}${productUrl.pathname}${productUrl.search}${productUrl.hash}`;
}
