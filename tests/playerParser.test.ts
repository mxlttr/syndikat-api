import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlayer } from '../src/scrapers/playerParser';

// Deliberately omit the nested tbody, as the upstream HTML does.
const header =
  '<tr><td></td><td><strong>Test Open</strong> / Test Series / 05.09.2026-06.09.2026</td><td>Results</td></tr>';
const details =
  '<tr><td></td><td colspan="4"><table class="table-borderless"><thead><tr><th>Runde</th></tr></thead><tr><td>2</td><td>991.462</td><td>O</td><td>18</td><td>ja</td></tr><tr><td>1</td><td>950,5</td><td>O</td><td>20</td><td>nein</td></tr></table></td></tr>';
const page = (rows: string) =>
  `<strong>Turnierhistorie für: Test Player</strong><div>Verein: Test Club</div><table data-search="true"><tbody>${rows}</tbody></table>`;

test('extracts individual rounds and tournament metadata without mixing nested cells', () => {
  const player = parsePlayer(page(header + details), 4390);
  assert.equal(player.name, 'Test Player');
  assert.equal(player.club, 'Test Club');
  assert.equal(player.gtNumber, 4390);
  assert.equal(player.tournaments.length, 1);
  assert.deepEqual(player.tournaments[0], {
    name: 'Test Open',
    tournamentId: null,
    pdgaEventId: null,
    series: 'Test Series',
    startDate: '2026-09-05',
    endDate: '2026-09-06',
    rounds: player.tournaments[0].rounds,
  });
  assert.equal(player.tournaments[0].rounds.length, 2);
  assert.deepEqual(player.tournaments[0].rounds[0], {
    roundNumber: 2,
    rating: 991.462,
    division: 'O',
    holes: 18,
    inRating: true,
  });
  assert.equal(player.tournaments[0].rounds[1].rating, 950.5);
  assert.equal(player.tournaments[0].rounds[1].inRating, false);
});

test('tolerates empty spacer rows before and between tournament pairs', () => {
  const spacer = '<tr><td colspan="4"> </td></tr>';
  assert.equal(
    parsePlayer(page(spacer + header + spacer + details + spacer + header + details), 4390)
      .tournaments.length,
    2,
  );
});

test('supports a valid player with no tournament history', () => {
  assert.deepEqual(parsePlayer(page(''), 4390).tournaments, []);
});

test('rejects missing or orphaned detail tables rather than returning partial results', () => {
  for (const rows of [header, details, header + details + details]) {
    assert.throws(() => parsePlayer(page(rows), 4390));
  }
});

test('rejects malformed dates, numbers, flags, columns, and headings', () => {
  const html = page(header + details);
  for (const [before, after] of [
    ['05.09.2026', '31.02.2026'],
    ['05.09.2026', '07.09.2026'],
    ['991.462', 'NaN'],
    ['991.462', '0x10'],
    ['991.462', ''],
    ['<td>18</td>', '<td>0</td>'],
    ['<td>ja</td>', '<td>maybe</td>'],
    ['<td>ja</td>', ''],
    ['Turnierhistorie für:', 'Error:'],
  ])
    assert.throws(() => parsePlayer(html.replace(before, after), 4390), `${before} -> ${after}`);
});

test('keeps IDs and rounds with their tournament even when names repeat', () => {
  const linked = header.replace(
    'Results',
    '<a href="https://turniere.discgolf.de/index.php?p=events&amp;sp=list-results&amp;id=2598">GT</a><a href="https://www.pdga.com/tour/event/104622">PDGA</a>',
  );
  const { tournaments } = parsePlayer(page(linked + details + header + details), 4390);
  assert.equal(tournaments.length, 2);
  assert.equal(tournaments[0].tournamentId, 2598);
  assert.equal(tournaments[0].pdgaEventId, 104622);
  assert.equal(tournaments[1].tournamentId, null);
  assert.equal(tournaments[1].pdgaEventId, null);
  assert.equal(tournaments[0].rounds.length, 2);
  assert.equal(tournaments[1].rounds.length, 2);
});

test('ignores placeholder, malformed, unrelated, and unsafe event IDs', () => {
  for (const href of [
    'https://www.pdga.com/tour/event/0',
    'https://www.pdga.com/tour/event/9007199254740992',
    'https://turniere.discgolf.de/index.php?id=oops',
    'https://example.com/tour/event/123',
    'http://[invalid',
  ]) {
    const round = parsePlayer(
      page(header.replace('Results', `<a href="${href}">Results</a>`) + details),
      4390,
    ).tournaments[0];
    assert.equal(round.tournamentId, null);
    assert.equal(round.pdgaEventId, null);
  }
});

test('reads the club after a PDGA profile link, with a separate photo block', () => {
  const html = page(header + details).replace(
    '<div>Verein: Test Club</div>',
    '<div><img src="profile.png" alt=""></div><div>PDGA: <a href="https://www.pdga.com/player/269738">269738</a><br>Verein: Disc Golf Syndikat e.V.<br><br></div>',
  );
  const player = parsePlayer(html, 2791);
  assert.equal(player.club, 'Disc Golf Syndikat e.V.');
  assert.equal(player.tournaments[0].rounds.length, 2);
});

test('allows a missing club without losing tournament history', () => {
  const player = parsePlayer(
    page(header + details).replace('Verein: Test Club', 'PDGA: 269738'),
    2791,
  );
  assert.equal(player.club, '');
  assert.equal(player.tournaments.length, 1);
});

test('preserves older rounds with an empty source division', () => {
  const player = parsePlayer(page(header + details.replaceAll('<td>O</td>', '<td></td>')), 2791);
  assert.equal(player.tournaments[0].rounds.length, 2);
  assert.equal(player.tournaments[0].rounds[0].division, '');
});

test('parses legacy date ranges and results links', () => {
  for (const [range, start, end] of [
    ['10.9. - 13.9.2020', '2020-09-10', '2020-09-13'],
    ['31.8. - 1.9.2019', '2019-08-31', '2019-09-01'],
    ['17.10. - 18.10.2020', '2020-10-17', '2020-10-18'],
  ]) {
    const legacy = header
      .replace('05.09.2026-06.09.2026', range)
      .replace('Results', '<a href="https://german-tour-online.de/events/results/1360">GT</a>');
    const tournament = parsePlayer(page(legacy + details), 169).tournaments[0];
    assert.equal(tournament.startDate, start);
    assert.equal(tournament.endDate, end);
    assert.equal(tournament.tournamentId, 1360);
  }
});

test('rejects invalid and reversed legacy date ranges', () => {
  for (const range of ['31.2. - 3.3.2020', '14.9. - 13.9.2020']) {
    assert.throws(() =>
      parsePlayer(page(header.replace('05.09.2026-06.09.2026', range) + details), 169),
    );
  }
});

test('preserves missing historical hole counts as null', () => {
  const player = parsePlayer(page(header + details.replace('<td>18</td>', '<td></td>')), 169);
  assert.equal(player.tournaments[0].rounds[0].holes, null);
  assert.equal(player.tournaments[0].rounds[1].holes, 20);
});
