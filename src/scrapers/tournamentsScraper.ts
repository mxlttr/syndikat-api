import { load } from 'cheerio';
import type { NextFunction, Request, Response } from 'express';
import { getCache, setCache } from '../cache';
import env from '../env';
import { getJson, getText } from '../http';
import { logger } from '../logger';
import { normalizeTournamentLocations } from '../services/locationService.js';
import type {
  MetrixTournament,
  OfficialTournament,
  RelatedTournament,
  TournamentDetail,
  TournamentDivision,
  TournamentFile,
  TournamentMoney,
  TournamentOutput,
  TournamentPlayer,
  TournamentRegistrationPhase,
  TournamentResult,
  TournamentWithPlayers,
} from '../types.js';

const isProduction = env.NODE_ENV === 'production';
const ON_TOUR_CACHE_KEY = 'tournaments:on-tour:v2';
const ON_TOUR_CONCURRENCY = 5;

export class TournamentNotFoundError extends Error {
  status = 404;
}

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

function text(value: string | undefined): string | null {
  const result = value?.replace(/\s+/g, ' ').trim();
  return result || null;
}

function labelled($: ReturnType<typeof load>, labels: string[]): string | null {
  let result: string | null = null;
  $('dt, th, label, strong, b').each((_, element) => {
    if (result) return;
    const label = $(element).text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (!labels.some((candidate) => label.includes(candidate))) return;
    const value =
      $(element).next().text() || $(element).parent().text().replace($(element).text(), '');
    result = text(value);
  });
  return result;
}

function numberValue(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function moneyValue(value: string | null): TournamentMoney | null {
  if (!value) return null;
  const amount = value
    .replace(/\./g, '')
    .replace(',', '.')
    .match(/-?\d+(?:\.\d+)?/)?.[0];
  if (!amount) return null;
  const currency = /€|eur/i.test(value) ? 'EUR' : /\$|usd/i.test(value) ? 'USD' : '';
  return currency ? { amount: Number(amount), currency } : null;
}

export function parseTournamentDetail(
  html: string,
  id: number,
  index?: OfficialTournament,
): TournamentDetail {
  const $ = load(html);
  const title = text($('h1').first().text()) ?? text($('title').text());
  if (!title || /^\/\s/.test(title))
    throw new TournamentNotFoundError(`Tournament ${id} was not found`);
  const tableRows: Array<readonly [string, string]> = [];
  $('table tr').each((_, row) => {
    const cells = $(row)
      .find('td, th')
      .map((__, cell) => text($(cell).text()) ?? '')
      .get();
    if (cells.length >= 2) tableRows.push([cells[0], cells[1]]);
  });
  const rowValue = (labels: string[]) =>
    tableRows.find(([label]) =>
      labels.some((candidate) => label.toLowerCase().includes(candidate)),
    )?.[1] ?? null;
  const dates = rowValue(['turnierbetrieb']) ?? labelled($, ['datum', 'turnierzeitraum']);
  const dateRange = dates;
  const dateMatches = dateRange?.match(
    /(\d{1,2}\.\d{1,2}\.\d{4})(?:\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4}))?/,
  );
  const germanDate = (value: string | undefined) => {
    if (!value) return null;
    const [day, month, year] = value.split('.').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  };
  const pageStartDate = germanDate(dateMatches?.[1]);
  const pageEndDate = germanDate(dateMatches?.[2]);
  const coordinateLink = $('a[href*="google.com/maps/place/"]')
    .attr('href')
    ?.match(/place\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const links = $('a[href]')
    .map((_, a) => $(a).attr('href'))
    .get()
    .filter((href): href is string => Boolean(href));
  const divisions: TournamentDivision[] = [];
  $('table').each((_, table) => {
    const headers = $(table)
      .find('thead th')
      .map((__, cell) => $(cell).text().trim().toLowerCase())
      .get();
    if (!headers.some((header) => /division|klasse|category/.test(header))) return;
    $(table)
      .find('tbody tr')
      .each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, cell) => text($(cell).text()) ?? '')
          .get();
        if (cells.length)
          divisions.push({
            name: cells[0],
            abbreviation: null,
            capacity: numberValue(cells[1] ?? null),
            registered: numberValue(cells[2] ?? null),
            fee: moneyValue(cells[3] ?? null),
          });
      });
  });
  if (!divisions.length) {
    $('table')
      .eq(3)
      .find('tr')
      .each((_, row) => {
        const cells = $(row)
          .find('td')
          .map((__, cell) => text($(cell).text()) ?? '')
          .get();
        if (cells.length === 2 && !/player pack|wildcards/i.test(cells[0]) && /€/.test(cells[1])) {
          divisions.push({
            name: cells[0],
            abbreviation: null,
            capacity: null,
            registered: null,
            fee: moneyValue(cells[1]),
          });
        }
      });
  }
  const results: TournamentResult[] = [];
  $('table').each((_, table) => {
    const headers = $(table)
      .find('thead th')
      .map((__, cell) => $(cell).text().trim().toLowerCase())
      .get();
    if (
      !headers.some((header) => /spieler|player|name/.test(header)) ||
      !headers.some((header) => /rang|rank|platz/.test(header))
    )
      return;
    $(table)
      .find('tbody tr')
      .each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, cell) => text($(cell).text()) ?? '')
          .get();
        if (cells.length >= 2)
          results.push({
            division: '',
            player: cells[1] ?? cells[0],
            rank: numberValue(cells[0]),
            score: cells[2] ?? null,
            rating: numberValue(cells[3] ?? null),
          });
      });
  });
  const coords = {
    lat: index?.location_latitude
      ? Number(index.location_latitude)
      : coordinateLink
        ? Number(coordinateLink[1])
        : null,
    lng: index?.location_longitude
      ? Number(index.location_longitude)
      : coordinateLink
        ? Number(coordinateLink[2])
        : null,
  };
  const phase: TournamentRegistrationPhase[] = dates
    ? [{ name: 'registration', start: null, end: null, capacity: null }]
    : [];
  return {
    id,
    title,
    organizer: rowValue(['veranstalter']) ?? labelled($, ['veranstalter', 'organizer']),
    director:
      rowValue(['turnierdirektor', 'ansprechpartner']) ??
      labelled($, ['turnierleitung', 'director']),
    venue: rowValue(['spielort', 'venue', 'course']),
    location: index?.location ?? rowValue(['ort']) ?? labelled($, ['ort', 'location']),
    station: null,
    coords,
    link: `${env.OFFICIAL_URL}?p=events&sp=view&id=${id}`,
    externalLinks: links.filter((link) => !link.includes('p=events')),
    startDate: index?.timestamp_start
      ? new Date(index.timestamp_start * 1000).toISOString()
      : (pageStartDate ?? dates),
    endDate: index?.timestamp_end
      ? new Date(index.timestamp_end * 1000).toISOString()
      : pageEndDate,
    series: rowValue(['serien']) ?? labelled($, ['serie', 'series']),
    registrationPhases: phase,
    eligibility: labelled($, ['teilnahmeberechtigung', 'eligibility']),
    format: rowValue(['spielformat']) ?? labelled($, ['format']),
    rounds: rowValue(['runden']) ? [rowValue(['runden']) as string] : [],
    courseHoles: numberValue(rowValue(['bahnen / hauptkurs']) ?? labelled($, ['löcher', 'holes'])),
    capacity:
      index?.spots ??
      numberValue(rowValue(['startplätze']) ?? labelled($, ['kapazität', 'capacity'])),
    indexCapacity: index?.spots ?? null,
    divisions,
    fees: moneyValue(
      rowValue(['startgeld', 'gebühr', 'fee']) ?? labelled($, ['startgeld', 'gebühr', 'fee']),
    ),
    prizeMoney: moneyValue(rowValue(['preisgeld']) ?? labelled($, ['preisgeld', 'prize money'])),
    files: $('a[href]')
      .filter((_, a) => /pdf|download|file/i.test($(a).attr('href') ?? ''))
      .map(
        (_, a): TournamentFile => ({
          name: text($(a).text()) ?? $(a).attr('href') ?? '',
          url: $(a).attr('href') ?? '',
        }),
      )
      .get(),
    description: text(
      $('.description, [class*="description"], [id*="description"]').first().text(),
    ),
    results,
  };
}

export async function fetchTournamentDetail(id: number): Promise<TournamentDetail> {
  if (!env.OFFICIAL_URL)
    throw new UpstreamTournamentError('Official tournament source is not configured');
  let index: OfficialTournament | undefined;
  try {
    index = (await getOfficialTournaments()).officialTournaments.find(
      (tournament) => tournament.event_id === id,
    );
  } catch {
    /* Historical details may exist without an index. */
  }
  try {
    return parseTournamentDetail(
      await getText(`${env.OFFICIAL_URL}?p=events&sp=view&id=${id}`),
      id,
      index,
    );
  } catch (error) {
    if (error instanceof TournamentNotFoundError) throw error;
    throw new UpstreamTournamentError('Tournament detail is temporarily unavailable', {
      cause: error,
    });
  }
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
  warn: (message: string) => logger.warn(message),
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
    const gtIndex = headers.indexOf('GT#');

    if (playerIndex < 0 || pdgaIndex < 0 || gtIndex < 0) return [];

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

        const pdgaId = Number(cells[pdgaIndex]) || null;
        const gtId = Number(cells[gtIndex]) || null;
        return [{ gtId, pdgaId, name, waitlisted: tableId === 'waitinglist' }];
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
