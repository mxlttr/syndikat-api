import assert from 'node:assert/strict';
import test from 'node:test';
import { filterRatingsByClub } from '../src/services/ratingsService';
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
