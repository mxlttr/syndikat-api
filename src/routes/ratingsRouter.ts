import { Router } from 'express';
import { getRatings } from '../scrapers/ratingsScraper';
import { filterRatingsByClub } from '../services/ratingsService';

const router = Router();

router.get<{ club?: string }>(['/', '/:club'], async (req, res) => {
  try {
    const data = await getRatings();
    res.json(filterRatingsByClub(data, req.params.club));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'An error occured' });
  }
});

export default router;
