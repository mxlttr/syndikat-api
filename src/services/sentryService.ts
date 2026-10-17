import * as Sentry from '@sentry/node';
import env from '../env';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) {
          const url = new URL(event.request.url);
          event.request.url = `${url.origin}${url.pathname}`;
        }
      }
      return event;
    },
  });
}

export function captureException(error: unknown, requestId?: string) {
  if (!env.SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    if (requestId) scope.setTag('request_id', requestId);
    Sentry.captureException(error);
  });
}

export function captureErrorLog(message: string) {
  if (!env.SENTRY_DSN) return;

  Sentry.captureMessage(message, 'error');
}

export function installExpressErrorHandler(
  app: Parameters<typeof Sentry.setupExpressErrorHandler>[0],
) {
  if (env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
}
