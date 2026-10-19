import type { Rating } from '../types';

function normalizeClub(club: string) {
  return club
    .toLowerCase()
    .replace(/disc[\s-]*golf/g, 'dg')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterRatingsByClub(ratings: Rating[], club?: string): Rating[] {
  const filters = (club ?? '').split(',').map(normalizeClub).filter(Boolean);
  return filters.length
    ? ratings.filter((rating) =>
        filters.some((filter) => normalizeClub(rating.club).includes(filter)),
      )
    : ratings;
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase('de-DE').trim();
}

export function filterRatings(
  ratings: Rating[],
  options: { club?: string; division?: string; search?: string } = {},
): Rating[] {
  const byClub = filterRatingsByClub(ratings, options.club);
  const division = options.division?.trim();
  const search = normalizeSearch(options.search ?? '');

  return byClub.filter((rating) => {
    if (division && rating.division !== division) return false;
    if (!search) return true;

    const playerSearch = normalizeSearch(`${rating.firstName} ${rating.lastName} ${rating.club}`);
    return playerSearch.includes(search);
  });
}
