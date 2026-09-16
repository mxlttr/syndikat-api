import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import env from './env';
import bagtagRouter from './routes/bagtagsRouter';
import indexRouter from './routes/indexRouter';
import playersRouter from './routes/playersRouter';
import productsRouter from './routes/productsRouter';
import ratingsRouter from './routes/ratingsRouter';
import scoresRouter from './routes/scoresRouter';
import stripeRouter from './routes/stripeRouter';
import tournamentsRouter from './routes/tournamentsRouter';
import trainingRouter from './routes/trainingRouter';

const app = express();

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

        console.warn(`Blocked CORS request from origin: ${origin}`);
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
app.use('/stripe-webhook', stripeRouter);
app.use('/training', trainingRouter);
app.use('/players', playersRouter);

app.use((err: Error & { status?: number }, _: Request, res: Response, __: NextFunction) => {
  console.error(err.stack);
  res.status(err.status ?? 500).send({ message: err.message });
});

export default app;
