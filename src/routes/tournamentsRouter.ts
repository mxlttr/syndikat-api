import { Router } from 'express';
import {
  fetchOfficial,
  getPlayersOnTour,
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

router.get('/on-tour', async (req, res, next) => getPlayersOnTour()(req, res, next));

export default router;
