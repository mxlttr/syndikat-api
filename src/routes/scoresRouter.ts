import { Router } from 'express';
import { logger } from '../logger';
import { scrapeScores, scrapeUltiorganizer } from '../scrapers/ultimateScoresScraper';

const router = Router();

router.get('/', async (_, res) => {
  try {
    const data = await scrapeUltiorganizer();
    res.json(data);
  } catch (error) {
    logger.error('Scores request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const data = await scrapeScores(id);
    res.json(data);
  } catch (error) {
    logger.error('Ultiorganizer scores request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

export default router;
