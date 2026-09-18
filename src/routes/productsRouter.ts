import { type Response, Router } from 'express';
import { isAbortError } from '../http';
import { logger } from '../logger';
import { handleCache } from '../scrapers/storesScraper';
import shops from '../shopList';

const router = Router();
const enabledShops = shops.filter((shop) => !shop.disabled);

function writeSseEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.get('/feed', async (_, res) => {
  try {
    const data = await handleCache('product-feed', 'all');
    res.json(data);
  } catch (error) {
    logger.error('Product feed request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

router.get('/search-stream/:query', async (req, res) => {
  const { query } = req.params;
  const controller = new AbortController();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let connectionClosed = false;
  const heartbeat = setInterval(() => {
    if (!connectionClosed) {
      res.write(': keep-alive\n\n');
    }
  }, 15_000);

  res.on('close', () => {
    connectionClosed = true;
    controller.abort();
    clearInterval(heartbeat);
  });

  try {
    writeSseEvent(res, 'start', {
      query,
      stores: enabledShops.map((shop) => shop.title),
    });

    const storePromises = enabledShops.map(async (shop) => {
      try {
        const products = await handleCache(shop.title, query, { signal: controller.signal });
        const safeProducts = Array.isArray(products) ? products : [];

        if (!connectionClosed) {
          writeSseEvent(res, 'store', {
            store: shop.title,
            products: safeProducts,
            count: safeProducts.length,
          });
        }

        return { store: shop.title, count: safeProducts.length, ok: true, aborted: false };
      } catch (error) {
        if (isAbortError(error)) {
          return { store: shop.title, count: 0, ok: false, aborted: true };
        }

        logger.error(`Error fetching products for ${shop.title}`, { error: String(error) });

        if (!connectionClosed) {
          writeSseEvent(res, 'store-error', {
            store: shop.title,
            message: 'Failed to fetch products for store',
          });
        }

        return { store: shop.title, count: 0, ok: false, aborted: false };
      }
    });

    const results = await Promise.all(storePromises);

    if (!connectionClosed) {
      writeSseEvent(res, 'end', {
        query,
        storesCompleted: results.length,
        totalProducts: results.reduce((sum, result) => sum + result.count, 0),
        failedStores: results
          .filter((result) => !result.ok && !result.aborted)
          .map((result) => result.store),
      });
      clearInterval(heartbeat);
      res.end();
    }
  } catch (error) {
    logger.error('Unexpected error in product search stream', { error: String(error) });
    if (!connectionClosed && !res.writableEnded) {
      writeSseEvent(res, 'error', {
        message: 'Unexpected stream error',
      });
      clearInterval(heartbeat);
      res.end();
    }
  }
});

router.get('/:type/:query', async (req, res) => {
  const { type, query } = req.params;
  try {
    const data = await handleCache(type, query);
    res.json(data);
  } catch (error) {
    logger.error('Product request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

export default router;
