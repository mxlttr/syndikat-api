import * as cheerio from 'cheerio';
import { getCache, setCache } from '../cache';
import env from '../env';
import { getJson, getText, isAbortError, throwIfAborted } from '../http';
import { logger } from '../logger';
import shops from '../shopList';

const crawledAt = new Date().toISOString();
const NEW_PRODUCT_DAYS = Number(env.NEW_PRODUCT_DAYS || '14');
const MAX_CONCURRENCY = 4;
const NON_DISCGOLF_PATTERNS = [
  /\bkidzz\b/i,
  /\b\d{2}\s*cm\b/i,
  /\beurodisc\b/i,
  /\bboomerang\b/i,
  /\bultimate\b/i,
  /\bfreestyle\b/i,
  /\bcatch\b/i,
];

interface ScrapeOptions {
  signal?: AbortSignal;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      throwIfAborted(signal);
      const current = index++;
      results[current] = await task(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface ShopifyProduct {
  title: string;
  created_at: string;
  variants: { price: string; available: boolean }[];
  images: { src: string }[];
  image?: string;
  handle: string;
  vendor: string;
  tags: string[];
  price: string;
  body: string;
  url: string;
  available: boolean;
}

interface DefaultProduct {
  title: string;
  price: number | null;
  image?: string | null;
  store: string;
  vendor?: string;
  url: string | null;
  flightNumbers?: {
    speed: string | null;
    glide: string | null;
    turn: string | null;
    fade: string | null;
  };
  stockStatus: 'available' | 'unavailable' | 'unknown';
  crawledAt: string;
  createdAt?: string;
}

interface JsonLdProduct {
  name?: string;
  image?: string | string[];
  offers?: {
    lowPrice?: number;
    highPrice?: number;
    priceCurrency?: string;
    availability?: string;
  };
}

function parseJsonLdProduct(html: string): JsonLdProduct | null {
  const regex = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  for (const match of html.matchAll(regex)) {
    if (!match[1]) continue;
    try {
      const data = JSON.parse(match[1]) as JsonLdProduct;
      if (data?.offers || data?.name) return data;
    } catch {
      // ignore malformed blocks
    }
  }
  return null;
}

async function scrapeStores(type: string, query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  switch (type) {
    case 'product-feed':
      return getShopifyProductFeeds({ signal });
    case 'discgolfstore':
      return scrapeDGStore(query, { signal });
    case 'thrownatur':
      return scrapeThrownatur(query, { signal });
    case 'crosslap':
      return scrapeCrosslap(query, { signal });
    case 'frisbeeshop':
      return scrapeFrisbeeshop(query, { signal });
    case 'insidethecircle':
      return scrapeInsideTheCircle(query, { signal });
    case 'chooseyourdisc':
      return scrapeChooseYourDisc(query, { signal });
    case 'discwolf':
      return scrapeDiscWolf(query, { signal });
    case 'birdieshop':
      return scrapeBirdieShop(query, { signal });
    case 'discgolf4you':
      return scrapeDiscgolf4You(query, { signal });
    case 'hyzerstore':
      return scrapeHyzerStore(query, { signal });
    default:
      return `Invalid Store Identifier. Try one of the following: ${shops.map((s) => s.title.toLowerCase())}.`;
  }
}

async function getShopifyProductFeeds(options: ScrapeOptions = {}) {
  const { signal } = options;
  const feedShops = Object.values(shops).filter(
    (shop) => shop.shopSystem === 'shopify' && shop.feed,
  );

  const allProducts = [];
  for (const shop of feedShops) {
    const shopFeed = shop.feed;
    if (!shop || !shopFeed) continue;
    try {
      throwIfAborted(signal);
      const baseURL = new URL(shopFeed).origin;
      const data = await getJson<{ products: ShopifyProduct[] }>(shopFeed, { signal });
      const products = data.products
        .filter((product) => {
          const createdAt = new Date(product.created_at);
          const newProductTime = new Date();
          newProductTime.setDate(newProductTime.getDate() - NEW_PRODUCT_DAYS);
          return createdAt >= newProductTime;
        })
        .map(
          (product): DefaultProduct => ({
            title: product.title,
            price: formatPrice(product.variants[0].price),
            image: product.images[0]?.src.replace('.png', '_400x.png') || null,
            store: shop.title || 'unknown',
            url: product.handle ? cleanURL(`${baseURL}/products/${product.handle}`) : null,
            vendor: product.vendor,
            stockStatus: product.variants.some((variant) => variant.available)
              ? 'available'
              : 'unavailable',
            crawledAt,
            createdAt: product.created_at,
          }),
        );

      allProducts.push(...products.map(normalizeProduct));
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.error('Error fetching product feed', { error: String(err) });
    }
  }
  return allProducts.sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );
}

function filterProducts(products: DefaultProduct[], query: string) {
  if (!products.length) return [];
  // strip 'innova' from query because DGStore does not include it in titles
  const queryWords = query
    .toLowerCase()
    .split(' ')
    .filter((word) => word !== 'innova');
  // remove products that don't contain not all of the query words
  return products
    .filter((product) => {
      const title = (product.title + (product.vendor ? ` ${product.vendor}` : '')).toLowerCase();
      return queryWords.every((word) => {
        const regex = new RegExp(`\\b${word}\\b`);
        return regex.test(title);
      });
    })
    .filter((product) => isRelevantDiscGolfProduct(product))
    .map(normalizeProduct);
}

async function scrapeDGStore(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'discgolfstore');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const products: DefaultProduct[] = [];
  const isPDP = $('.product-detail').length > 0;

  if (isPDP) {
    products.push({
      title: $('.product-title').text()?.trim(),
      price: formatPrice($('meta[itemprop="price"]').attr('content')),
      image: $('meta[itemprop="image"]').attr('content')?.trim(),
      store: 'discgolfstore',
      url: cleanURL($('.breadcrumb-item.active a').attr('href')),
      stockStatus: 'available',
      crawledAt,
    });
  } else {
    $('.product-wrapper').each((_, el) => {
      products.push({
        title: $(el).find('.productbox-title a').text()?.trim(),
        price: formatPrice($(el).find('meta[itemprop="price"]').attr('content')),
        image: $(el).find('meta[itemprop="image"]').attr('content')?.trim(),
        store: 'discgolfstore',
        url: cleanURL($(el).find('.productbox-title a').attr('href')),
        stockStatus: 'available',
        crawledAt,
      });
    });
  }
  return filterProducts(products, query);
}

async function scrapeThrownatur(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'thrownatur');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const products: DefaultProduct[] = [];
  const productElements = $('.tnd-upl-item').length ? $('.tnd-upl-item') : $('.product-container');

  productElements.each((_, el) => {
    const title =
      $(el).find('.tnd-upl-title-link').text()?.trim() || $(el).find('.product-url').text()?.trim();
    const imageSrc =
      $(el).find('.tnd-upl-img').attr('src') || $(el).find('.product-image img').attr('src');
    const image = imageSrc
      ? `https://thrownatur-discgolf.de/${imageSrc
          .replace('thumbnail_images', 'info_images')
          .trim()}`
      : null;
    const priceText =
      $(el).find('.tnd-upl-price-current').text()?.toLowerCase().trim() ||
      $(el).find('.current-price-container').text()?.toLowerCase().trim() ||
      '';
    const priceCleaned = priceText.includes('nur') ? priceText.split('nur')[1] : priceText;
    const price = Number([...priceCleaned].filter((char) => Number(char) > -1).join(''));
    const shippingText = $(el).find('.tnd-upl-shipping-value').first().text()?.toLowerCase().trim();
    const stockStatusIcon = $(el).find('.shipping-info-short img').attr('src');
    const stockStatus =
      $(el).find('.ribbon-sold-out').length || shippingText?.includes('vergriffen')
        ? 'unavailable'
        : shippingText?.includes('arbeitstage') ||
            stockStatusIcon?.includes('bestellbar') ||
            shippingText?.includes('lieferzeit')
          ? 'available'
          : stockStatusIcon?.includes('gray')
            ? 'unknown'
            : 'unknown';
    products.push({
      title,
      price,
      image,
      store: 'thrownatur',
      url: cleanURL(
        $(el).find('a.tnd-upl-title-link').attr('href') || $(el).find('a.product-url').attr('href'),
      ),
      flightNumbers: {
        speed:
          $(el).find('.tnd-upl-flight-speed').first().text() ||
          $(el).find('.title-description .disc-guide-display-speed').text() ||
          null,
        glide:
          $(el).find('.tnd-upl-flight-glide').first().text() ||
          $(el).find('.title-description .disc-guide-display-glide').text() ||
          null,
        turn:
          $(el).find('.tnd-upl-flight-turn').first().text() ||
          $(el).find('.title-description .disc-guide-display-turn').text() ||
          null,
        fade:
          $(el).find('.tnd-upl-flight-fade').first().text() ||
          $(el).find('.title-description .disc-guide-display-fade').text() ||
          null,
      },
      stockStatus,
      crawledAt,
    });
  });
  return filterProducts(products, query);
}

async function scrapeCrosslap(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'crosslap');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const products: DefaultProduct[] = [];

  $('.product-container').each((_, el) => {
    $(el).find('.productOldPrice').remove();
    const price = Number(
      [...($(el).find('.current-price-container').text()?.trim() ?? '')]
        .filter((char) => Number(char) > -1)
        .join(''),
    );
    const stockStatusIcon = $(el).find('.shipping-info-short img').attr('src');
    const stockStatus =
      stockStatusIcon?.includes('/status/1') && !$(el).find('.ribbon-sold-out').length
        ? 'available'
        : 'unavailable';

    const flightString = $(el).find('.description').text().trim();
    const flightRegex = /Speed (-?\d+), Glide (-?\d+), Turn (-?\d+), Fade (-?\d+)/;
    const flightMatch = flightString?.match(flightRegex);
    products.push({
      title: $(el).find('.product-url ').text()?.trim(),
      price,
      image: `https://discgolf-shop.de/${$(el).find('.product-image img').attr('src')?.trim()}`,
      store: 'crosslap',
      url: cleanURL($(el).find('a.product-url').attr('href')),
      flightNumbers: flightMatch
        ? {
            speed: flightMatch[1],
            glide: flightMatch[2],
            turn: flightMatch[3],
            fade: flightMatch[4],
          }
        : undefined,
      stockStatus,
      crawledAt,
    });
  });
  return filterProducts(products, query);
}

async function scrapeFrisbeeshop(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'frisbeeshop');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const products: DefaultProduct[] = [];

  $('.product-box').each((_, el) => {
    const price = Number(
      [...($(el).find('.product-price').text().split('€')[0]?.trim() ?? '')]
        .filter((char) => Number(char) > -1)
        .join(''),
    );
    products.push({
      title: $(el).find('a.product-name').text()?.trim(),
      price,
      image:
        $(el)
          .find('.product-image-wrapper img')
          .attr('srcset')
          ?.trim()
          ?.split(' 400w')[0]
          ?.split('800w, ')[1] || $(el).find('.product-image-wrapper img').attr('src')?.trim(),
      store: 'frisbeeshop',
      url: cleanURL($(el).find('a.product-name').attr('href')),
      stockStatus: 'unknown',
      crawledAt,
    });
  });
  return filterProducts(products, query);
}

async function scrapeInsideTheCircle(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'insidethecircle');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const searchData = await getJson<{
    resources: { results: { products: ShopifyProduct[] } };
  }>(url, { signal });
  const products: DefaultProduct[] = searchData.resources.results.products.map((product) => {
    const flightRegex = /\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|/;
    const flightMatch = product?.body.match(flightRegex);
    const flightNumbers = flightMatch
      ? {
          speed: flightMatch[1],
          glide: flightMatch[2],
          turn: flightMatch[3],
          fade: flightMatch[4],
        }
      : undefined;
    return {
      title: product.title,
      price: formatPrice(product.price),
      image: product.image?.replace('.png', '_400x.png'),
      store: 'insidethecircle',
      url: cleanURL(`https://www.inside-the-circle.de${product.url}`),
      flightNumbers,
      vendor: product.vendor,
      stockStatus: product.available ? 'available' : 'unavailable',
      crawledAt,
    };
  });
  return filterProducts(products, query);
}

async function scrapeChooseYourDisc(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'chooseyourdisc');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const searchData = await getJson<{
    resources: { results: { products: ShopifyProduct[] } };
  }>(url, { signal });
  const products: DefaultProduct[] = searchData.resources.results.products.map((product) => {
    const flightNumbers = {
      speed: product.tags.find((tag) => tag.includes('Speed '))?.replace('Speed ', '') || null,
      glide: product.tags.find((tag) => tag.includes('Glide '))?.replace('Glide ', '') || null,
      turn: product.tags.find((tag) => tag.includes('Turn '))?.replace('Turn ', '') || null,
      fade: product.tags.find((tag) => tag.includes('Fade '))?.replace('Fade ', '') || null,
    };
    return {
      title: product.title,
      price: formatPrice(product.price),
      image: product.image?.replace('.jpg', '_400x.jpg'),
      store: 'chooseyourdisc',
      url: cleanURL(`https://www.chooseyourdisc.com${product.url}`),
      vendor: product.vendor,
      flightNumbers,
      stockStatus: product.available ? 'available' : 'unavailable',
      crawledAt,
    };
  });
  return filterProducts(products, query);
}

async function scrapeDiscWolf(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'discwolf');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const searchData = await getJson<{
    resources: { results: { products: ShopifyProduct[] } };
  }>(url, { signal });
  const products: DefaultProduct[] = searchData.resources.results.products.map((product) => {
    const flightRegex =
      /Speed ([\d.,]+) \/ Glide ([\d.,]+) \/ Turn (-?[\d.,]+) \/ Fade (-?[\d.,]+)/;
    const flightMatch = product.body.match(flightRegex);
    const flightNumbers = flightMatch
      ? {
          speed: flightMatch[1],
          glide: flightMatch[2],
          turn: flightMatch[3],
          fade: flightMatch[4],
        }
      : undefined;
    return {
      title: product.title,
      price: formatPrice(product.price),
      image: product.image?.replace('.png', '_400x.png'),
      store: 'discwolf',
      url: cleanURL(`https://www.discwolf.com${product.url}`),
      flightNumbers,
      vendor: product.vendor,
      stockStatus: product.available ? 'available' : 'unavailable',
      crawledAt,
    };
  });
  return filterProducts(products, query);
}

async function scrapeBirdieShop(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'birdieshop');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query);
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const productItems = Array.from($('.search-result'));
  if (productItems.length === 0) return [];
  const products = (await mapWithConcurrency(
    productItems,
    MAX_CONCURRENCY,
    async (el): Promise<DefaultProduct | null> => {
      throwIfAborted(signal);
      const url = `https://www.birdie-shop.com${$(el).attr('data-url')}`;
      if (!url.includes('/p/')) return null;
      try {
        const productHtml = await getText(url, { signal });
        const $product = cheerio.load(productHtml);
        const jsonLd = parseJsonLdProduct(productHtml);
        const price = jsonLd?.offers?.lowPrice
          ? Math.round(jsonLd.offers.lowPrice * 100)
          : Number(
              [...$product('.product-price').text().trim()]
                .filter((char) => Number(char) > -1)
                .join(''),
            );
        const image = $product('.product-gallery-slides-item-image')?.first()?.attr('data-src');
        const isInStock = jsonLd?.offers?.availability?.includes('InStock');
        const isOutOfStock = jsonLd?.offers?.availability?.includes('OutOfStock');
        const stockStatus = isInStock ? 'available' : isOutOfStock ? 'unavailable' : 'unknown';
        const list = $product('.product-details ul').text();
        const flightRegex = /Speed: (-?\d+)Glide: (-?\d+)Turn: (-?\d+)Fade: (-?\d+)/;
        const flightMatch = list?.match(flightRegex);
        const flightNumbers = flightMatch
          ? {
              speed: flightMatch[1],
              glide: flightMatch[2],
              turn: flightMatch[3],
              fade: flightMatch[4],
            }
          : undefined;
        const title =
          $product('h1').first().text()?.trim() ||
          jsonLd?.name?.split(' - ')[0]?.trim() ||
          $(el).find('.sqs-title').text()?.trim();
        const jsonImage = typeof jsonLd?.image === 'string' ? jsonLd.image : jsonLd?.image?.[0];
        return {
          title,
          price,
          image: image
            ? `${image}?format=500w`
            : jsonImage
              ? `${jsonImage}?format=500w`
              : undefined,
          store: 'birdieshop',
          url: cleanURL(url),
          flightNumbers,
          stockStatus,
          crawledAt,
        } as DefaultProduct;
      } catch (err) {
        if (isAbortError(err)) throw err;
        logger.error('Error fetching product page', { error: String(err) });
        return null;
      }
    },
    signal,
  )) as DefaultProduct[];
  return filterProducts(products.filter(Boolean), query);
}

async function scrapeDiscgolf4You(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'discgolf4you');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query).replace('{{page}}', '1');
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const pagesLength =
    Number(
      [...$('#pagination-container a.page-link:not(.next)').last().text().trim()]
        .filter((char) => Number(char))
        .join(''),
    ) || 1;
  const products: DefaultProduct[] = [];

  const pageIndices = Array.from({ length: pagesLength }, (_, i) => i + 1);
  const pageResults = await mapWithConcurrency(
    pageIndices,
    MAX_CONCURRENCY,
    async (i) => {
      const nextPageUrl = shop.url.replace('{{query}}', query).replace('{{page}}', i.toString());
      try {
        throwIfAborted(signal);
        const nextPageHtml = await getText(nextPageUrl, { signal });
        const $nextPage = cheerio.load(nextPageHtml);
        const productItems = Array.from($nextPage('.product'));
        return productItems.map((el) => {
          const price = Number(
            [
              ...$nextPage(el)
                .find('.price span :not(del) span bdi, .price span > span bdi')
                .text()
                .trim(),
            ]
              .filter((char) => Number(char) > -1)
              .join(''),
          );
          const flightNumbers = {
            speed: $nextPage(el).find('.flight-attribute-speed b').text() || null,
            glide: $nextPage(el).find('.flight-attribute-glide b').text() || null,
            turn: $nextPage(el).find('.flight-attribute-turn b').text() || null,
            fade: $nextPage(el).find('.flight-attribute-fade b').text() || null,
          };
          return {
            title: $nextPage(el).find('.woocommerce-loop-product__title').text(),
            price,
            image: $nextPage(el).find('img').attr('src'),
            store: 'discgolf4you',
            url: cleanURL($nextPage(el).find('a').attr('href')),
            flightNumbers,
            stockStatus: 'unknown',
            crawledAt,
          } as DefaultProduct;
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        logger.error('Error fetching product page', { error: String(err) });
        return [];
      }
    },
    signal,
  );
  products.push(...pageResults.flat());

  return filterProducts(products, query);
}

async function scrapeHyzerStore(query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  const shop = shops.find((s) => s.title === 'hyzerstore');
  if (!shop) return null;
  const url = shop.url.replace('{{query}}', query).replace('{{page}}', '1');
  const html = await getText(url, { signal });
  const $ = cheerio.load(html);
  const pagesLength =
    Number(
      [...$('.woocommerce-pagination').find('li .page-numbers:not(.next)').last().text().trim()]
        .filter((char) => Number(char))
        .join(''),
    ) || 1;
  const products: DefaultProduct[] = [];

  const pageIndices = Array.from({ length: pagesLength }, (_, i) => i + 1);
  const pageResults = await mapWithConcurrency(
    pageIndices,
    MAX_CONCURRENCY,
    async (i) => {
      const nextPageUrl = shop.url.replace('{{query}}', query).replace('{{page}}', i.toString());
      try {
        throwIfAborted(signal);
        const nextPageHtml = i === 1 ? html : await getText(nextPageUrl, { signal });
        const $nextPage = cheerio.load(nextPageHtml);
        const productItems = Array.from($nextPage('.product'));
        return productItems.map((el) => {
          $nextPage(el).find('.price del bdi').remove();
          const price = Number(
            [...$nextPage(el).find('.price span bdi').text().trim()]
              .filter((char) => Number(char) > -1)
              .join(''),
          );
          const flightNumbers = {
            speed: $nextPage(el).find('.btn-speed').text() || null,
            glide: $nextPage(el).find('.btn-glide').text() || null,
            turn: $nextPage(el).find('.btn-turn').text() || null,
            fade: $nextPage(el).find('.btn-fade').text() || null,
          };
          return {
            title: $nextPage(el).find('.woocommerce-loop-product__title').text(),
            price,
            image: $nextPage(el).find('img').attr('src'),
            store: 'hyzerstore',
            url: cleanURL($nextPage(el).find('a').attr('href')),
            flightNumbers,
            stockStatus: 'unknown',
            crawledAt,
          } as DefaultProduct;
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        logger.error('Error fetching product page', { error: String(err) });
        return [];
      }
    },
    signal,
  );
  products.push(...pageResults.flat());

  return filterProducts(products, query);
}

export async function handleCache(type: string, query: string, options: ScrapeOptions = {}) {
  const { signal } = options;
  throwIfAborted(signal);

  if (env.NODE_ENV === 'production') {
    const cacheKey = `${type}-${query}`;
    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;
    throwIfAborted(signal);
    const data = await scrapeStores(type, query, { signal });
    throwIfAborted(signal);
    await setCache(cacheKey, data);
    return data;
  }
  return scrapeStores(type, query, { signal });
}

function formatPrice(str: string | undefined): number | null {
  if (!str) return null;
  const dotNotation = str.trim().replace(',', '.');
  const euro = Number.parseFloat(dotNotation);
  return Math.round(euro * 100);
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : undefined;
}

function isRelevantDiscGolfProduct(product: DefaultProduct): boolean {
  const haystack = `${product.title} ${product.vendor ?? ''}`.toLowerCase();
  return !NON_DISCGOLF_PATTERNS.some((pattern) => pattern.test(haystack));
}

function normalizeTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+[|:;/,-]+\s*$/g, '')
    .trim();
}

function normalizeImageUrl(string: string | null | undefined): string | null {
  const trimmed = string?.trim();
  if (!trimmed || trimmed.startsWith('data:image/')) return null;

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsedURL = new URL(normalized);
    parsedURL.hash = '';
    return parsedURL.toString();
  } catch {
    return normalized;
  }
}

function normalizeFlightNumbers(product: DefaultProduct): DefaultProduct['flightNumbers'] {
  if (!product.flightNumbers) return undefined;

  const flightNumbers = {
    speed: normalizeOptionalString(product.flightNumbers.speed) ?? null,
    glide: normalizeOptionalString(product.flightNumbers.glide) ?? null,
    turn: normalizeOptionalString(product.flightNumbers.turn) ?? null,
    fade: normalizeOptionalString(product.flightNumbers.fade) ?? null,
  };

  return Object.values(flightNumbers).some(Boolean) ? flightNumbers : undefined;
}

function normalizeProduct(product: DefaultProduct): DefaultProduct {
  return {
    ...product,
    title: normalizeTitle(product.title),
    image: normalizeImageUrl(product.image),
    store: normalizeOptionalString(product.store) ?? product.store.trim(),
    vendor: normalizeOptionalString(product.vendor),
    url: cleanURL(product.url),
    flightNumbers: normalizeFlightNumbers(product),
    createdAt: normalizeOptionalString(product.createdAt),
  };
}

function cleanURL(string: string | null | undefined): string | null {
  const trimmed = string?.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const parsedURL = new URL(normalized);
    parsedURL.search = '';
    parsedURL.hash = '';
    return parsedURL.toString();
  } catch {
    return null;
  }
}
