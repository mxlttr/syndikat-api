import { Router } from 'express';
import { z } from 'zod';
import env from '../env';
import { logger } from '../logger';

const router = Router();
const bagTagSchema = z.array(
  z.object({
    Rank: z.string(),
    Name: z.string(),
    Motiv: z.string(),
  }),
);

router.get('/', async (_, res) => {
  if (!env.BAGTAG_ENDPOINT) {
    res.status(500).json({ message: 'BAGTAG_ENDPOINT not configured' });
    return;
  }

  try {
    const response = await fetch(env.BAGTAG_ENDPOINT);
    const body = await response.json();
    const parsed = bagTagSchema.safeParse(body);
    if (!parsed.success) {
      logger.error('Bag-tag endpoint returned an invalid payload', { error: parsed.error });
      res.status(500).json({ message: 'Bag-tag endpoint returned an invalid payload' });
      return;
    }
    res.json(parsed.data);
  } catch (error) {
    logger.error('Bag-tag request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

export default router;
