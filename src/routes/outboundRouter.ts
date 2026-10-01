import { Router } from 'express';
import { logger } from '../logger';
import { analyticsOptedOut, trackProductClick } from '../services/analyticsService';
import { getOutboundShop, resolveOutboundDestination } from '../services/outboundService';

const router = Router();

router.get('/:shopId/*path', (req, res) => {
  const configuredShop = getOutboundShop(req.params.shopId);
  if (!configuredShop) return res.status(404).send('Invalid outbound shop');
  const segments = req.params.path;
  const pathname = `/${(Array.isArray(segments) ? segments : [segments]).join('/')}`;
  const requestUrl = new URL(req.originalUrl, 'http://localhost');
  const payload = { path: `${pathname}${requestUrl.search}` };

  const destination = resolveOutboundDestination(req.params.shopId, payload);
  if (!destination) return res.status(400).send('Invalid outbound path');
  const shop = configuredShop.title;

  const optedOut = analyticsOptedOut(req);
  const clickContext = {
    requestId: res.locals.requestId,
    shop,
    path: destination.pathname,
    analytics: optedOut ? 'opted_out' : 'pending',
  };
  logger.info('Outbound product click', clickContext);

  if (!optedOut) {
    void trackProductClick(shop, destination)
      .then((sent) => {
        if (sent) {
          logger.info('Product click analytics delivered', { ...clickContext, analytics: 'sent' });
        } else {
          logger.info('Product click analytics not configured', {
            ...clickContext,
            analytics: 'not_configured',
          });
        }
      })
      .catch((error) => {
        logger.warn('Product click analytics failed', {
          ...clickContext,
          analytics: 'failed',
          error: String(error),
        });
      });
  }

  res.redirect(302, destination.toString());
});

export default router;
