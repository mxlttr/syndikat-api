import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Response, Router } from 'express';
import { databaseAvailable, databasePool } from '../database';
import env from '../env';

const router = Router();

function unavailable(response: Response) {
  response.status(503).json({ message: 'Training signups are not configured' });
}

function participantName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function trainingDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? '' : value;
}

function hashToken(token: string) {
  return createHash('sha256').update(`${env.SESSION_SECRET}:${token}`).digest('hex');
}

function passwordMatches(password: unknown) {
  if (typeof password !== 'string' || !env.TRAINING_SIGNUP_PASSWORD) return false;
  const expected = Buffer.from(env.TRAINING_SIGNUP_PASSWORD);
  const candidate = Buffer.from(password);
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function tokenMatches(token: string, tokenHash: string) {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(tokenHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function configured() {
  return databaseAvailable() && Boolean(env.SESSION_SECRET && env.TRAINING_SIGNUP_PASSWORD);
}

/**
 * Friday cut-off is a local club rule, so it is calculated in Europe/Berlin
 * rather than the server timezone. Signup reopens for the following Friday at
 * 18:00 on Friday.
 */
function trainingStatus() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(value('hour'));
  let daysUntilFriday =
    (5 - ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday ?? '') + 7) % 7;
  if (daysUntilFriday === 0 && hour >= 18) daysUntilFriday = 7;
  const date = new Date(
    Date.UTC(
      Number(value('year')),
      Number(value('month')) - 1,
      Number(value('day')) + daysUntilFriday,
    ),
  );
  return {
    date: date.toISOString().slice(0, 10),
    signupOpen: weekday !== 'Fri' || hour < 18,
  };
}

router.use(express.json());

router.get('/status', (_, response) => {
  if (!configured()) return unavailable(response);
  return response.json(trainingStatus());
});

router.get('/participants', async (request, response, next) => {
  if (!configured()) return unavailable(response);
  const date = trainingDate(request.query.date);
  if (!date) return response.status(400).json({ message: 'A valid date is required' });
  try {
    const result = await databasePool().query<{ id: string; name: string }>(
      'select id, display_name as name from training_participants where training_date = $1 order by created_at',
      [date],
    );
    return response.json({ participants: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/participants', async (request, response, next) => {
  if (!configured()) return unavailable(response);
  const status = trainingStatus();
  if (!status.signupOpen)
    return response.status(403).json({ message: 'Signup for the next training opens on Saturday' });
  if (typeof request.body?.name === 'string' && request.body.name.length > 40)
    return response.status(400).json({ message: 'A name must be 40 characters or fewer' });
  const name = participantName(request.body?.name);
  if (!name) return response.status(400).json({ message: 'A name is required' });
  if (typeof request.body?.password !== 'string')
    return response.status(400).json({ message: 'A password is required' });
  if (!passwordMatches(request.body?.password))
    return response.status(401).json({ message: 'Incorrect password' });
  const removalToken = randomBytes(32).toString('base64url');
  try {
    const result = await databasePool().query<{ id: string; name: string; date: string }>(
      `insert into training_participants (training_date, display_name, removal_token_hash)
       values ($1, $2, $3) returning id, display_name as name, training_date::text as date`,
      [status.date, name, hashToken(removalToken)],
    );
    return response.status(201).json({ participant: result.rows[0], removalToken });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      return response.status(409).json({ message: 'This name is already signed up' });
    return next(error);
  }
});

router.delete('/participants/:id', async (request, response, next) => {
  if (!configured()) return unavailable(response);
  const authorization = request.header('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response.status(401).json({ message: 'A removal token is required' });
  try {
    const participant = (
      await databasePool().query<{ removal_token_hash: string }>(
        'select removal_token_hash from training_participants where id = $1',
        [request.params.id],
      )
    ).rows[0];
    if (!participant || !tokenMatches(token, participant.removal_token_hash))
      return response.status(401).json({ message: 'Invalid removal token' });
    await databasePool().query('delete from training_participants where id = $1', [
      request.params.id,
    ]);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
