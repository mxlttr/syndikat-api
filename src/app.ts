import crypto from 'node:crypto';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import env from './env';
import { logger } from './logger';
import bagtagRouter from './routes/bagtagsRouter';
import indexRouter from './routes/indexRouter';
import playersRouter from './routes/playersRouter';
import productsRouter from './routes/productsRouter';
import recommendationsRouter from './routes/recommendationsRouter';
import ratingsRouter from './routes/ratingsRouter';
import scoresRouter from './routes/scoresRouter';
import stripeRouter from './routes/stripeRouter';
import tournamentsRouter from './routes/tournamentsRouter';
import trainingRouter from './routes/trainingRouter';

const app = express();
app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  const requestId = req.header('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  res.locals.requestId = requestId;
  next();
});
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
  }),
);

if (env.NODE_ENV === 'production') {
  const allowedOrigins = (env.ALLOWED_ORIGIN ?? '').split(',').map((o) => o.trim());
  const allowedOriginSuffixes = (env.ALLOWED_ORIGIN_SUFFIX ?? '')
    .split(',')
    .map((o) => o.trim().toLowerCase());
  const isAllowedOrigin = (origin: string) =>
    allowedOrigins.some((allowedOrigin) => allowedOrigin && allowedOrigin === origin) ||
    (() => {
      try {
        const url = new URL(origin);
        const hostname = url.hostname.toLowerCase();

        if (url.protocol !== 'https:') {
          return false;
        }

        return allowedOriginSuffixes.some((allowedSuffix) => {
          if (!allowedSuffix) return false;

          const normalizedSuffix = allowedSuffix.startsWith('.')
            ? allowedSuffix.slice(1)
            : allowedSuffix;
          return (
            hostname === normalizedSuffix ||
            hostname.endsWith(`.${normalizedSuffix}`) ||
            hostname.endsWith(`--${normalizedSuffix}`)
          );
        });
      } catch {
        return false;
      }
    })();

  app.use(
    cors({
      origin: (origin, callback) => {
        // allow requests with no origin
        // (curl, mobile apps, server-to-server)
        if (!origin) return callback(null, true);

        if (isAllowedOrigin(origin)) {
          return callback(null, true);
        }

        logger.warn('Blocked CORS request', { origin });
        const error = new Error(`CORS policy: origin ${origin} not allowed`) as Error & {
          status?: number;
        };
        error.status = 403;
        return callback(error);
      },
    }),
  );
} else {
  app.use(cors({ origin: true }));
}

app.use('/', indexRouter);
app.use('/tournaments', tournamentsRouter);
app.use('/bagtag', bagtagRouter);
app.use('/ratings', ratingsRouter);
app.use('/scores', scoresRouter);
app.use('/products', productsRouter);
app.use('/recommendations', recommendationsRouter);
app.use('/stripe-webhook', stripeRouter);
app.use('/training', trainingRouter);
app.use('/players', playersRouter);

app.use((err: Error & { status?: number }, _: Request, res: Response, __: NextFunction) => {
  logger.error('Unhandled request error', { error: err.stack, requestId: res.locals.requestId });
  res.status(err.status ?? 500).send({ message: err.message, requestId: res.locals.requestId });
});

export default app;
