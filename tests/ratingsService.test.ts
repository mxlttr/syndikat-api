import assert from 'node:assert/strict';
import test from 'node:test';
import { filterRatings, filterRatingsByClub } from '../src/services/ratingsService';
import type { Rating } from '../src/types';

const ratings = [
  { club: 'DG Syndikat', rank: 12, divisionCount: 100 },
  { club: 'Other Club', rank: 13, divisionCount: 100 },
  { club: '', rank: 14, divisionCount: 100 },
] as Rating[];

test('omitting the club preserves the full list', () => {
  assert.equal(filterRatingsByClub(ratings), ratings);
});

test('club filter accepts full names, abbreviations, case, and whitespace', () => {
  for (const club of [
    'disc golf syndikat',
    'DiscGolf Syndikat',
    'Disc-Golf Syndikat',
    'DG SYNDIKAT',
    '  disc   golf   syndikat  ',
    'syndikat',
  ]) {
    assert.deepEqual(filterRatingsByClub(ratings, club), [ratings[0]]);
  }
  assert.deepEqual(
    filterRatingsByClub([{ ...ratings[0], club: 'Disc Golf Syndikat' }], 'dg syndikat'),
    [{ ...ratings[0], club: 'Disc Golf Syndikat' }],
  );
});

test('unknown clubs return no ratings without changing the source list', () => {
  assert.deepEqual(filterRatingsByClub(ratings, 'unknown'), []);
  assert.equal(ratings.length, 3);
});

test('rating filters combine club, division, and player search', () => {
  const filtered = filterRatings(
    [
      { ...ratings[0], firstName: 'Anna', lastName: 'Müller', division: 'Open' },
      { ...ratings[0], firstName: 'Bernd', lastName: 'Schmidt', division: 'Master' },
      { ...ratings[1], firstName: 'Anna', lastName: 'Other', division: 'Open' },
    ],
    { club: 'syndikat', division: 'Open', search: 'müller' },
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].firstName, 'Anna');
});
