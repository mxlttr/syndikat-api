import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { z } from 'zod';
import {
  getDrivingRoute,
  RoutePlannerError,
  type RoutePlannerResponse,
} from '../services/routePlannerService.js';

const routeRequestSchema = z.object({
  origin: z.string().trim().min(3, 'Origin address is required'),
  date: z.string().trim().min(1).optional(),
  destination: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    station: z.string().trim().min(1).optional(),
  }),
});

export async function handleTournamentRoute(req: Request, res: Response) {
  const parsedRequest = routeRequestSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: parsedRequest.error.issues[0]?.message ?? 'Invalid route request',
    });
  }

  try {
    const route = await getDrivingRoute(parsedRequest.data);
    return res.json(route satisfies RoutePlannerResponse);
  } catch (error) {
    if (error instanceof RoutePlannerError) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
      });
    }

    throw error;
  }
}

export const tournamentRouteJsonMiddleware = express.json({ limit: '32kb' });

export function handleTournamentRouteJsonError(
  error: Error & { status?: number; type?: string },
  _: Request,
  res: Response,
  next: NextFunction,
) {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON',
    });
  }

  return next(error);
}
