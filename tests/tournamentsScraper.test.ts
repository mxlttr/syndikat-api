import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfficialTournament } from '../src/types';

for (const key of [
  'NODE_ENV',
  'ALLOWED_ORIGIN',
  'BAGTAG_ENDPOINT',
  'CACHE_EXPIRY',
  'DISCORD_CHANNEL_ID',
  'DISCORD_WEBHOOK_URL',
  'METRIX_URL',
  'OPENROUTESERVICE_API_KEY',
  'OFFICIAL_URL',
  'RATING_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TOURNAMENTS_API_SECRET',
  'TOURNAMENTS_API_TOKEN',
]) {
  process.env[key] = 'test';
}
process.env.OFFICIAL_URL = 'https://official.example.test/events';

const { fetchPlayersOnTour, getPlayersOnTour } = await import('../src/scrapers/tournamentsScraper');

function tournament(event_id: number): OfficialTournament {
  return {
    event_id,
    event_name: `Tournament ${event_id}`,
    location_latitude: '51.1',
    location_longitude: '10.1',
    location: 'Germany',
    num_attendees: 10,
    spots: 72,
    status: 1,
    timestamp_end: 1_700_000_000,
    timestamp_registration_phase: 1_699_000_000,
    timestamp_start: 1_699_500_000,
    title_picture_path: '',
    website_external: '',
  };
}

const playerList = (name: string) => `
  <table id="starterlist">
    <thead><tr><th>Spieler</th><th>PDGA#</th><th>GT#</th><th>Verein</th></tr></thead>
    <tbody><tr><td>${name}</td><td>123</td><td>456</td><td>Syndikat</td></tr></tbody>
  </table>
`;

test('on-tour returns successful tournaments when individual player lists fail', async () => {
  const warnings: string[] = [];
  const result = await fetchPlayersOnTour({
    getTournamentIndex: async () => [tournament(2506), tournament(2698)],
    getPlayerList: async (current) => {
      if (current.event_id === 2506) throw new Error('upstream timeout');
      return playerList('Successful Player');
    },
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.complete, false);
  assert.deepEqual(
    result.tournaments.map(({ event_id }) => event_id),
    [2698],
  );
  assert.deepEqual(warnings, ['Unable to fetch player lists for tournament IDs: 2506']);
});

test('on-tour returns 502 when every player list fails', async () => {
  await assert.rejects(
    fetchPlayersOnTour({
      getTournamentIndex: async () => [tournament(2506)],
      getPlayerList: async () => {
        throw new Error('upstream timeout');
      },
      warn: () => {},
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'UpstreamTournamentError' &&
      'status' in error &&
      error.status === 502,
  );
});

test('on-tour treats an upstream homepage as a failed player list', async () => {
  await assert.rejects(
    fetchPlayersOnTour({
      getTournamentIndex: async () => [tournament(2506)],
      getPlayerList: async () => '<html><title>turniere.discgolf.de - Discgolf</title></html>',
      warn: () => {},
    }),
    /Tournament player lists are temporarily unavailable/,
  );
});

test('on-tour only caches complete scrapes in production', async () => {
  let cached: unknown = null;
  let writes = 0;
  const handler = getPlayersOnTour({
    production: true,
    getCached: async () => null,
    setCached: async (value) => {
      cached = value;
      writes += 1;
    },
    scrape: async () => ({
      complete: false,
      tournaments: [],
    }),
  });

  const response = {
    send: (value: unknown) => {
      cached = value;
    },
  } as never;
  await handler({} as never, response, (() => {}) as never);

  assert.equal(writes, 0);
  assert.deepEqual(cached, []);
});
