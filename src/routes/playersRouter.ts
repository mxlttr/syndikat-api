import { Router } from 'express';
import { logger } from '../logger';
import { getPlayer } from '../scrapers/playersScaper';
import { analyticsOptedOut, trackPlayerLoaded } from '../services/analyticsService';

const router = Router();

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    res.status(400).json({ message: 'Invalid GT number' });
    return;
  }

  try {
    const data = await getPlayer(id);
    if (!analyticsOptedOut(req)) {
      void trackPlayerLoaded(Number(id)).catch((error) => {
        logger.warn('Player analytics failed', { error: String(error), gtNumber: Number(id) });
      });
    }
    res.json(data);
  } catch (error) {
    logger.error('Player request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

export default router;
