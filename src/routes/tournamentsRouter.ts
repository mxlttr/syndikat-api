import { Router } from 'express';
import {
  fetchOfficial,
  fetchTournamentDetail,
  getTournaments,
  scrapeMetrix,
} from '../scrapers/tournamentsScraper';
import {
  handleTournamentRoute,
  handleTournamentRouteJsonError,
  tournamentRouteJsonMiddleware,
} from './routePlanner.js';

const router = Router();

router.post(
  '/route',
  tournamentRouteJsonMiddleware,
  handleTournamentRouteJsonError,
  handleTournamentRoute,
);

router.get('/', async (req, res, next) =>
  getTournaments('official', fetchOfficial)(req, res, next),
);

router.get('/metrix', async (req, res, next) =>
  getTournaments('metrix', scrapeMetrix)(req, res, next),
);

router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).send({ message: 'Tournament ID must be a positive integer' });
    return;
  }
  try {
    res.send(await fetchTournamentDetail(id));
  } catch (error) {
    next(error);
  }
});

export default router;
