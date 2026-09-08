import { load } from 'cheerio';
import type { NextFunction, Request, Response } from 'express';
import { getCache, setCache } from '../cache';
import env from '../env';
import { getJson, getText } from '../http';
import { normalizeTournamentLocations } from '../services/locationService.js';
import type {
  MetrixTournament,
  OfficialTournament,
  RelatedTournament,
  TournamentOutput,
  TournamentPlayer,
  TournamentWithPlayers,
} from '../types.js';

const isProduction = env.NODE_ENV === 'production';
const ON_TOUR_CACHE_KEY = 'tournaments:on-tour:v2';
const ON_TOUR_CONCURRENCY = 5;

export function getTournaments<T>(type: string, callback: () => Promise<T>) {
  return async (_: Request, res: Response, next: NextFunction) => {
    try {
      const result = isProduction ? await handleCache(type, callback) : await callback();
      res.send(result);
    } catch (err) {
      next(err);
    }
  };
}

async function handleCache<T>(type: string, callback: () => Promise<T>): Promise<T> {
  const cacheData = await getCache<T>(type);
  if (cacheData) return cacheData;

  const result = await callback();
  await setCache(type, result);
  return result;
}

async function getMetrixTournaments() {
  const url = env.METRIX_URL;
  if (!url) throw new Error('METRIX_URL not configured');
  const metrixTournaments = await getJson<MetrixTournament[]>(url);
  return { metrixTournaments };
}

export async function scrapeMetrix(): Promise<TournamentOutput[]> {
  const { metrixTournaments } = await getMetrixTournaments();

  const tournaments = removeDuplicates(
    metrixTournaments.map(
      (tournament: MetrixTournament): TournamentOutput => ({
        title: tournament[1].split(' &rarr;')[0],
        round: tournament[1].split(' &rarr;')[tournament[1].split(' &rarr;').length - 1],
        event_id: Number(tournament[0]),
        link: `https://discgolfmetrix.com/${tournament[0]}`,
        location: tournament[7].split(' &rarr;')[0],
        coords: {
          lat: tournament[2],
          lng: tournament[3],
        },
        dates: {
          startTournament: tournament[4].toString(),
        },
      }),
    ),
  );

  return normalizeTournamentLocations(tournaments);
}

async function getOfficialTournaments() {
  if (!env.OFFICIAL_URL || !env.TOURNAMENTS_API_TOKEN || !env.TOURNAMENTS_API_SECRET) {
    throw new Error('Official tournament environment variables not configured');
  }
  const url = `${env.OFFICIAL_URL}?p=api&key=tournaments-actual&token=${env.TOURNAMENTS_API_TOKEN}&secret=${env.TOURNAMENTS_API_SECRET}`;
  const officialTournaments = await getJson<OfficialTournament[]>(url);
  return { officialTournaments };
}

export async function fetchOfficial(): Promise<TournamentOutput[]> {
  const { officialTournaments } = await getOfficialTournaments();

  const tournaments = officialTournaments
    .filter((tournament) => tournament.location_latitude && tournament.location_longitude)
    .map(
      (tournament: OfficialTournament): TournamentOutput => ({
        title: tournament.event_name || 'Kein Name vergeben',
        event_id: tournament.event_id,
        link: `${env.OFFICIAL_URL}?p=events&sp=view&id=${tournament.event_id}`,
        location: tournament.location,
        coords: {
          lat: Number.parseFloat(tournament.location_latitude) ?? null,
          lng: Number.parseFloat(tournament.location_longitude) ?? null,
        },
        badge: tournament.status === 2 ? 'vorläufig' : undefined,
        dates: {
          startTournament: tournament.timestamp_start
            ? new Date(tournament.timestamp_start * 1000)
            : null,
          endTournament: tournament.timestamp_end
            ? new Date(tournament.timestamp_end * 1000)
            : null,
          startRegistration: tournament.timestamp_registration_phase
            ? new Date(tournament.timestamp_registration_phase * 1000)
            : null,
        },
        spots: {
          overall: tournament.spots,
          used: tournament.num_attendees,
        },
      }),
    );

  return normalizeTournamentLocations(tournaments);
}

function removeDuplicates(tournaments: TournamentOutput[]): TournamentOutput[] {
  const seen: Record<string, number> = {};
  const relatedTournaments: Record<string, RelatedTournament[]> = {};

  const result = tournaments
    .filter((tournament) => {
      if (!tournament.round || !tournament.event_id) return true;
      const handle = `${tournament.title} - ${tournament.dates.startTournament}`;
      if (seen[handle]) {
        const data: RelatedTournament = {
          id: tournament.event_id,
          round: tournament.round.trim(),
        };
        const key = String(seen[handle]);
        if (relatedTournaments[key]?.length) {
          relatedTournaments[key].push(data);
        } else {
          relatedTournaments[key] = [data];
        }
        return false;
      } else {
        seen[handle] = tournament.event_id;
        return true;
      }
    })
    .map((tournament) => {
      const key = String(tournament.event_id);
      if (relatedTournaments[key]) {
        tournament.relatedTournaments = relatedTournaments[key];
      }
      return tournament;
    });

  return result;
}

export class UpstreamTournamentError extends Error {
  status = 502;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UpstreamTournamentError';
  }
}

export interface OnTourScrapeResult {
  tournaments: TournamentWithPlayers[];
  complete: boolean;
}

export interface OnTourScraperDependencies {
  getTournamentIndex: () => Promise<OfficialTournament[]>;
  getPlayerList: (tournament: OfficialTournament) => Promise<string>;
  warn: (message: string) => void;
}

function playerListUrl(eventId: number) {
  return `${env.OFFICIAL_URL}?p=events&sp=list-players&id=${eventId}`;
}

const onTourScraperDependencies: OnTourScraperDependencies = {
  getTournamentIndex: async () => (await getOfficialTournaments()).officialTournaments,
  getPlayerList: (tournament) => getText(playerListUrl(tournament.event_id)),
  warn: console.warn,
};

function playersFromTournamentList(tournamentData: string): TournamentPlayer[] {
  const $ = load(tournamentData);
  return ['starterlist', 'waitinglist'].flatMap((tableId) => {
    const table = $(`#${tableId}`);
    const headers = table
      .find('thead th')
      .map((_, header) => $(header).text().trim())
      .get();
    const playerIndex = headers.indexOf('Spieler');
    const pdgaIndex = headers.indexOf('PDGA#');

    if (playerIndex < 0 || pdgaIndex < 0) return [];

    return table
      .find('tbody tr')
      .toArray()
      .flatMap((row) => {
        const cells = $(row)
          .find('td')
          .map((_, cell) => $(cell).text().trim())
          .get();
        if (!cells.some((cell) => cell.includes('Syndikat'))) return [];

        const name = cells[playerIndex];
        if (!name) return [];

        const pdgaId = Number(cells[pdgaIndex]);
        return [{ pdga_id: pdgaId || null, name, waitlisted: tableId === 'waitinglist' }];
      });
  });
}

function tournamentWithPlayers(
  tournament: OfficialTournament,
  tournamentData: string,
): TournamentWithPlayers {
  return {
    title: tournament.event_name || 'Kein Name vergeben',
    event_id: tournament.event_id,
    link: `${env.OFFICIAL_URL}?p=events&sp=view&id=${tournament.event_id}`,
    location: tournament.location,
    coords: {
      lat: Number.parseFloat(tournament.location_latitude) || null,
      lng: Number.parseFloat(tournament.location_longitude) || null,
    },
    dates: {
      startTournament: tournament.timestamp_start
        ? new Date(tournament.timestamp_start * 1000)
        : null,
      endTournament: tournament.timestamp_end ? new Date(tournament.timestamp_end * 1000) : null,
      startRegistration: tournament.timestamp_registration_phase
        ? new Date(tournament.timestamp_registration_phase * 1000)
        : null,
    },
    spots: {
      overall: tournament.spots,
      used: tournament.num_attendees,
    },
    our_players: playersFromTournamentList(tournamentData),
  };
}

/** Fetch Syndikat players from all live tournaments without caching partial upstream results. */
export async function fetchPlayersOnTour(
  dependencies: OnTourScraperDependencies = onTourScraperDependencies,
): Promise<OnTourScrapeResult> {
  let officialTournaments: OfficialTournament[];
  try {
    officialTournaments = await dependencies.getTournamentIndex();
  } catch (error) {
    throw new UpstreamTournamentError('Tournament index is temporarily unavailable', {
      cause: error,
    });
  }

  const liveTournaments = officialTournaments.filter((tournament) => tournament.num_attendees > 0);
  const settled: PromiseSettledResult<TournamentWithPlayers>[] = [];

  for (let start = 0; start < liveTournaments.length; start += ON_TOUR_CONCURRENCY) {
    const batch = liveTournaments.slice(start, start + ON_TOUR_CONCURRENCY);
    settled.push(
      ...(await Promise.allSettled(
        batch.map(async (tournament) =>
          tournamentWithPlayers(tournament, await dependencies.getPlayerList(tournament)),
        ),
      )),
    );
  }

  const rejected = settled.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected.length > 0) {
    const failedIds = settled.flatMap((result, index) =>
      result.status === 'rejected' ? [liveTournaments[index].event_id] : [],
    );
    dependencies.warn(`Unable to fetch player lists for tournament IDs: ${failedIds.join(', ')}`);
  }
  if (settled.length > 0 && rejected.length === settled.length) {
    throw new UpstreamTournamentError('Tournament player lists are temporarily unavailable');
  }

  return {
    tournaments: settled
      .filter(
        (result): result is PromiseFulfilledResult<TournamentWithPlayers> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((tournament) => tournament.our_players.length > 0),
    complete: rejected.length === 0,
  };
}

export interface OnTourHandlerOptions {
  production?: boolean;
  scrape?: () => Promise<OnTourScrapeResult>;
  getCached?: () => Promise<TournamentWithPlayers[] | null>;
  setCached?: (value: TournamentWithPlayers[]) => Promise<void>;
}

export function getPlayersOnTour(options: OnTourHandlerOptions = {}) {
  const production = options.production ?? isProduction;
  const scrape = options.scrape ?? fetchPlayersOnTour;
  const getCached =
    options.getCached ?? (() => getCache<TournamentWithPlayers[]>(ON_TOUR_CACHE_KEY));
  const setCached = options.setCached ?? ((value) => setCache(ON_TOUR_CACHE_KEY, value));

  return async (_: Request, res: Response, next: NextFunction) => {
    try {
      if (production) {
        const cachedData = await getCached();
        if (cachedData) {
          res.send(cachedData);
          return;
        }
      }

      const result = await scrape();
      if (production && result.complete) await setCached(result.tournaments);
      res.send(result.tournaments);
    } catch (err) {
      next(err);
    }
  };
}
