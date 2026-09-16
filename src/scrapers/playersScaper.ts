import { getCache, setCache } from '../cache';
import env from '../env';
import { getText } from '../http';
import type { Player } from '../types';
import { parsePlayer } from './playerParser';

export { parsePlayer } from './playerParser';

export async function getPlayer(id: string): Promise<Player> {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error('Invalid GT number');
  }
  const cacheKey = `player:${id}:v1`;
  if (env.NODE_ENV === 'production') {
    const cached = await getCache<Player>(cacheKey);
    if (cached) return cached;
  }
  if (!env.RATING_URL) throw new Error('RATING_URL not configured');
  const endpoint = new URL('detail.php', env.RATING_URL);
  endpoint.searchParams.set('v', '1');
  endpoint.searchParams.set('gtn', id);
  const html = await getText(endpoint.toString());
  const player = parsePlayer(html, Number(id));
  if (env.NODE_ENV === 'production') {
    await setCache(cacheKey, player, 5 * 60);
  }
  return player;
}
