import env from '../env';
import { getText } from '../http';
import type { Player } from '../types';
import { parsePlayer } from './playerParser';

export { parsePlayer } from './playerParser';

export async function getPlayer(id: string): Promise<Player> {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error('Invalid GT number');
  }
  if (!env.RATING_URL) throw new Error('RATING_URL not configured');
  const endpoint = new URL('detail.php', env.RATING_URL);
  endpoint.searchParams.set('v', '1');
  endpoint.searchParams.set('gtn', id);
  const html = await getText(endpoint.toString());
  return parsePlayer(html, Number(id));
}
