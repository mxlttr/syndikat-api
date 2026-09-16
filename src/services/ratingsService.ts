import type { Rating } from '../types';

function normalizeClub(club: string) {
  return club
    .toLowerCase()
    .replace(/disc[\s-]*golf/g, 'dg')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterRatingsByClub(ratings: Rating[], club?: string): Rating[] {
  const filter = normalizeClub(club ?? '');
  return filter ? ratings.filter((rating) => normalizeClub(rating.club).includes(filter)) : ratings;
}
