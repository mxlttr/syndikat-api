import { Router } from 'express';
import { z } from 'zod';
import env from '../env';
import { logger } from '../logger';

const router = Router();

const playerProfileSchema = z.object({
  skill: z.enum(['beginner', 'intermediate', 'advanced']),
  distance: z.enum(['60', '90', '120', '150']),
  throwType: z.enum(['backhand', 'forehand', 'both']),
  category: z.enum(['midrange', 'putter', 'approach', 'control-driver', 'distance-driver']),
  stability: z.enum(['understable', 'stable', 'overstable']),
  shot: z.enum(['straight', 'turnover', 'hyzer', 'approach']),
});

router.post('/discs', async (req, res) => {
  const parsed = playerProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid disc recommendation profile', issues: parsed.error.issues });
    return;
  }

  if (!env.JEV_API_KEY) {
    res.status(503).json({ message: 'Disc recommendations are not configured' });
    return;
  }

  const profile = parsed.data;
  const state = `A disc golfer is looking for a ${profile.category}. Their skill level is ${profile.skill}, maximum distance is ${profile.distance} metres, and they throw mostly ${profile.throwType}. They want a ${profile.stability} disc for ${profile.shot} shots.`;

  try {
    const response = await fetch('https://jevtypesafeai.com/api/v1/decide', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.JEV_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state,
        questions: {
          recommended_category: {
            type: 'choice',
            instructions: 'Which disc category is the best fit for this player?',
            criteria: {
              putter: 'A putting or throwing putter',
              approach: 'An approach disc',
              midrange: 'A midrange disc',
              'control-driver': 'A fairway or control driver',
              'distance-driver': 'A distance driver',
            },
          },
          beginner_fit: {
            type: 'score',
            instructions: 'How suitable is this player profile for starting with the requested disc category?',
            criteria: ['Poor fit', 'Possible fit', 'Good fit', 'Excellent fit'],
          },
          stability_fit: {
            type: 'score',
            instructions: 'How well does the requested stability match this player and intended shot?',
            criteria: ['Poor match', 'Partial match', 'Good match', 'Excellent match'],
          },
        },
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      logger.error('Jev disc recommendation failed', { status: response.status, body: String(body) });
      const providerMessage =
        body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : 'Unknown provider error';
      res.status(502).json({
        message: 'Disc recommendation provider failed',
        providerStatus: response.status,
        providerMessage,
      });
      return;
    }

    res.json(body);
  } catch (error) {
    logger.error('Jev disc recommendation request failed', { error: String(error) });
    res.status(502).json({ message: 'Disc recommendation provider unavailable' });
  }
});

export default router;
