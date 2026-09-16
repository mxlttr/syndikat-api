import * as cheerio from 'cheerio';
import type { HistoricRating, Player, PlayerTournament, Round } from '../types';

function parseDate(value: string): string {
  const [day, month, year] = value.split('.').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid tournament date: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function parseNumber(value: string, integer = false): number {
  const normalized = value.replace(',', '.');
  const number = Number(normalized);
  if (
    !/^-?\d+(?:\.\d+)?$/.test(normalized) ||
    !Number.isFinite(number) ||
    (integer && (!Number.isInteger(number) || number <= 0))
  ) {
    throw new Error(`Invalid round number field: ${value}`);
  }
  return number;
}

function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function parsePlayer(html: string, gtNumber: number): Player {
  const $ = cheerio.load(html);
  const historicRatings: HistoricRating[] = [];
  const chartScript = $('script')
    .toArray()
    .map((script) => $(script).text())
    .find((text) => text.includes('labels:') && text.includes('DRating'));
  const labels =
    chartScript
      ?.match(/labels:\s*\[([\s\S]*?)\]/)?.[1]
      .match(/['"](\d{4}-\d{2}-\d{2})['"]/g)
      ?.map((value) => value.slice(1, -1)) ?? [];
  const values =
    chartScript
      ?.match(/data:\s*\[([\s\S]*?)\]/)?.[1]
      .match(/['"](-?\d+(?:\.\d+)?)['"]/g)
      ?.map((value) => Number(value.slice(1, -1))) ?? [];
  labels.forEach((date, index) => {
    const rating = values[index];
    if (!Number.isFinite(rating)) return;
    const previous = historicRatings[historicRatings.length - 1];
    if (!previous || previous.rating !== rating) historicRatings.push({ date, rating });
  });
  const heading = $('body > strong').first().text().trim();
  const name = heading.match(/^Turnierhistorie für:\s*(.+)$/)?.[1]?.trim();
  // Profile blocks may contain a photo or PDGA link before the club line.
  // Preserve <br> boundaries because Cheerio's text() joins adjacent lines.
  const profileLines = $('body > div')
    .toArray()
    .flatMap((element) => {
      const block = $(element).clone();
      block.find('br').replaceWith('\n');
      return block
        .text()
        .split(/\r?\n/)
        .map((line) => line.trim());
    });
  const clubLine = profileLines.find((line) => /^Verein:/.test(line));
  const club = clubLine?.replace(/^Verein:\s*/, '') ?? '';
  const table = $('table[data-search="true"]');
  if (!name || table.length !== 1) {
    throw new Error('Unexpected player page structure');
  }

  const tournaments: PlayerTournament[] = [];
  const tournamentRows = table.children('tbody').children('tr');
  const consumed = new Set<unknown>();
  // Match row contents instead of assuming every other row is a tournament.
  tournamentRows.each((_, el) => {
    if (consumed.has(el)) return;
    if (!$(el).text().trim() && !$(el).find('table').length) return;
    const row = $(el);
    const info = row.children('td').eq(1);
    const title = info.children('strong');
    const tournament = title.text().trim();
    if (!tournament) throw new Error('Missing tournament title');

    let tournamentId: number | null = null;
    let pdgaEventId: number | null = null;
    row.find('a[href]').each((_, link) => {
      try {
        const url = new URL($(link).attr('href') ?? '', 'https://rating.discgolf.de');
        if (url.hostname === 'turniere.discgolf.de' && url.pathname === '/index.php') {
          tournamentId = positiveId(url.searchParams.get('id')) ?? tournamentId;
        }
        if (['german-tour-online.de', 'www.german-tour-online.de'].includes(url.hostname)) {
          tournamentId =
            positiveId(url.pathname.match(/^\/events\/results\/(\d+)\/?$/)?.[1] ?? null) ??
            tournamentId;
        }
        if (url.hostname === 'www.pdga.com' || url.hostname === 'pdga.com') {
          pdgaEventId =
            positiveId(url.pathname.match(/^\/tour\/event\/(\d+)\/?$/)?.[1] ?? null) ?? pdgaEventId;
        }
      } catch {
        // Missing, placeholder, or malformed links do not identify an event.
      }
    });

    const metadata = info.clone();
    metadata.children('strong').remove();
    const match = metadata
      .text()
      .trim()
      .match(/^\/\s*(.*?)\s*\/\s*(\d{1,2}\.\d{1,2}\.(?:\d{4})?)\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})$/);
    if (!match) throw new Error(`Unexpected tournament metadata: ${tournament}`);
    const [, series, rawStartDate, rawEndDate] = match;
    // Legacy ranges omit the start year, e.g. 31.8. - 1.9.2019.
    const startDate = parseDate(
      rawStartDate.endsWith('.') ? rawStartDate + rawEndDate.split('.')[2] : rawStartDate,
    );
    const endDate = parseDate(rawEndDate);
    if (endDate < startDate) throw new Error(`Reversed tournament dates: ${tournament}`);

    let details = row.next('tr');
    while (details.length && !details.text().trim() && !details.find('table').length) {
      details = details.next('tr');
    }
    const roundTable = details.children('td').children('table.table-borderless');
    if (details[0]) consumed.add(details[0]);
    const roundRows = roundTable.children('tbody').children('tr');
    if (roundTable.length !== 1 || !roundRows.length) {
      throw new Error(`Missing round table: ${tournament}`);
    }
    const rounds: Round[] = [];
    roundRows.each((_, roundElement) => {
      const cells = $(roundElement).children('td');
      if (cells.length !== 5) throw new Error(`Unexpected round columns: ${tournament}`);
      const cell = (index: number) => cells.eq(index).text().trim();
      const inRating = cell(4);
      if (!['ja', 'nein'].includes(inRating)) {
        throw new Error(`Unexpected round values: ${tournament}`);
      }
      rounds.push({
        roundNumber: parseNumber(cell(0), true),
        rating: parseNumber(cell(1)),
        division: cell(2) ?? null,
        holes: cell(3) ? parseNumber(cell(3), true) : null,
        inRating: inRating === 'ja',
      });
    });
    tournaments.push({
      tournamentId,
      pdgaEventId,
      name: tournament,
      series,
      startDate,
      endDate,
      rounds,
    });
  });
  return { name, gtNumber, club, tournaments, historicRatings };
}
