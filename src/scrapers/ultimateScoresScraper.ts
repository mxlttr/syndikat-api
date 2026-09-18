import * as cheerio from 'cheerio';
import { getText } from '../http';
import { logger } from '../logger';
import { getCell } from '../utils';

const BASE_URL = 'https://scores.frisbeesportverband.de/';
const endpoint = new URL(BASE_URL);

export async function scrapeScores(id: string) {
  endpoint.searchParams.set('view', 'games');
  endpoint.searchParams.set('series', id);

  try {
    const html = await getText(endpoint.toString());
    const $ = cheerio.load(html);
    const rows = $('.admintable.wide tr').toArray();
    const seriesTitle = $(`#seriesNav${id}`).text().trim();
    const games = await Promise.all(
      rows.map(async (row) => {
        const columns = $(row).find('td');
        if (!columns || columns.length === 0) return;

        const metaInfo = $(row).closest('table').prevUntil('h2').nextAll('h3').first();
        const regex = /\d+\.\d+\.\d{4}/;
        const dateString = metaInfo.text().trim().match(regex);
        const time = getCell($(columns[0])).toString();

        return {
          teams: {
            home: getCell($(columns[2])) ?? '',
            away: getCell($(columns[4])) ?? '',
          },
          scores: {
            home: getCell($(columns[5]), true) ?? 0,
            away: getCell($(columns[7]), true) ?? 0,
          },
          pitch: getCell($(columns[1])) ?? '',
          date: dateString ? formatDate(dateString[0], time) : null,
          location: metaInfo.find('a').text().trim() ?? '',
          roundTitle:
            $(row).closest('tbody').find('th').text().trim().replace(seriesTitle, '').trim() ?? '',
        };
      }),
    );
    return games.filter(Boolean);
  } catch (error) {
    logger.error('Scores scrape failed', { error: String(error) });
  }

  return [];
}

export async function scrapeUltiorganizer() {
  const data: { title: string; id: string }[] = [];
  try {
    const html = await getText(endpoint.toString());
    const $ = cheerio.load(html);

    const series = $('.menuserieslevel').toArray();
    series.forEach((series) => {
      const title = $(series).find('a').text().trim() ?? '';
      const id = $(series).find('a').attr('href')?.replace('#', '') ?? '';
      if (!title || !id) return;
      data.push({
        title,
        id,
      });
    });
  } catch (error) {
    logger.error('Ultiorganizer scores scrape failed', { error: String(error) });
  }

  return data ?? [];
}

function formatDate(string: string, time: string): Date | null {
  if (!string) return null;

  let newString = string.split('.').reverse().join('-');
  if (time) {
    newString += ` ${time}:00 GMT`;
  }
  return new Date(newString);
}
