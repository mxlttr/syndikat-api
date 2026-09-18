import { Router } from 'express';
import { logger } from '../logger';
import { getRatings } from '../scrapers/ratingsScraper';
import { filterRatings, filterRatingsByClub } from '../services/ratingsService';

const router = Router();

router.get<{ club?: string }>(['/', '/:club'], async (req, res) => {
  try {
    // Ratings change only when the upstream source is refreshed. Keep browser
    // and CDN caches useful without making the data stale for too long.
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800');
    const data = await getRatings();
    const hasPagination = ['page', 'pageSize', 'division', 'search', 'q'].some(
      (key) => req.query[key] !== undefined,
    );
    if (!hasPagination) {
      res.json(filterRatingsByClub(data, req.params.club));
      return;
    }

    const page = parseQueryInt(req.query.page, 1, 1);
    const pageSize = parseQueryInt(req.query.pageSize, 50, 1, 100);
    const filtered = filterRatings(data, {
      club: typeof req.query.club === 'string' ? req.query.club : req.params.club,
      division: typeof req.query.division === 'string' ? req.query.division : undefined,
      search:
        typeof req.query.search === 'string'
          ? req.query.search
          : (req.query.q as string | undefined),
    });
    const start = (page - 1) * pageSize;
    const divisions = [...new Set(data.map((rating) => rating.division))].sort((a, b) =>
      a.localeCompare(b, 'de', { numeric: true }),
    );
    res.json({
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      divisions,
    });
  } catch (error) {
    logger.error('Ratings request failed', { error: String(error) });
    res.status(500).json({ message: 'An error occured' });
  }
});

function parseQueryInt(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

export default router;
