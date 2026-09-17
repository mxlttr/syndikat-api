import * as cheerio from 'cheerio';
import { getCache, setCache } from '../cache';
import env from '../env';
import { getText } from '../http';
import type { Rating } from '../types';
import { getCell } from '../utils';

const endpoint = env.RATING_URL ? new URL(env.RATING_URL) : null;

/**
 * The rating source has no stable API. Keep this parser aligned with its table
 * columns and treat a changed page as an upstream failure rather than guessing.
 */
async function scrapeRatings(): Promise<Rating[]> {
  if (!endpoint) {
    throw new Error('RATING_URL not configured');
  }
  try {
    const html = await getText(endpoint.toString());
    const $ = cheerio.load(html);

    const divisionCount = getDivisionCount($);

    const rows = $('#table tbody tr').toArray();
    const ratings: Rating[] = await Promise.all(
      rows.map(async (element) => {
        const columns = $(element).find('td');
        const club = getCell($(columns[8])).toString();
        const pathname = $(columns[3]).find('a').attr('href');
        const link = pathname ? new URL(pathname, endpoint).toString() : '';
        const ratingChangeSymbol = getCell($(columns[6])).toString().slice(-1).charCodeAt(0);
        const ratingChange =
          ratingChangeSymbol === 8593 ? 1 : ratingChangeSymbol === 8595 ? -1 : null;

        return {
          firstName: String(getCell($(columns[2]))),
          lastName: String(getCell($(columns[3]))),
          rating: getCell($(columns[6]), true) || 0,
          ratingChange,
          divisionCount: divisionCount[getCell($(columns[5]))] || 0,
          gtNumber: getCell($(columns[4]), true),
          division: getCell($(columns[5])),
          lastRound: new Date(getCell($(columns[9])).toString().split('.').reverse().join('-')),
          roundCount: getCell($(columns[10]), true),
          rank: getCell($(columns[0]), true),
          divisionRank: getCell($(columns[1]), true),
          link,
          club: club
            .replace('Disc Golf', 'DG')
            .replace('Discgolf', 'DG')
            .replace('Disc-Golf', 'DG')
            .replace('DiscGolf', 'DG'),
        };
      }),
    );

    return ratings.filter(Boolean);
  } catch (error) {
    console.error(error);
    throw new Error('Unable to retrieve ratings');
  }
}

export async function getRatings(): Promise<Rating[]> {
  // Production: try cache first
  if (env.NODE_ENV === 'production') {
    const cache = await getCache<Rating[]>('ratings');
    if (Array.isArray(cache)) return cache;

    const ratings = await scrapeRatings();

    // Only successful rating arrays reach this point, so failures are never cached.
    await setCache('ratings', ratings, 30 * 60); // 30 minutes
    return ratings;
  }

  // Non-production: always scrape fresh
  return await scrapeRatings();
}

function getDivisionCount($: cheerio.Root) {
  const divisions = $('#table tbody tr')
    .toArray()
    .map((element) => getCell($(element).find('td').eq(5)));

  const divisionCount = divisions.reduce<Record<string, number>>((acc, division) => {
    if (!acc[division]) acc[division] = 0;
    acc[division]++;
    return acc;
  }, {});

  return divisionCount;
}
