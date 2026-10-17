import * as Sentry from '@sentry/node';
import env from '../env';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    initialScope: { tags: { service: 'api' } },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) {
          event.request.url = stripQueryString(event.request.url);
        }
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.data?.url && typeof breadcrumb.data.url === 'string') {
            breadcrumb.data.url = stripQueryString(breadcrumb.data.url);
          }
          return breadcrumb;
        });
      }
      delete event.extra;
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

export function captureErrorLog(message: string, context?: Record<string, unknown>) {
  if (!env.SENTRY_DSN) return;

  const requestId = typeof context?.requestId === 'string' ? context.requestId : undefined;
  const error = context?.error;

  if (error instanceof Error) {
    captureException(error, requestId);
    return;
  }

  Sentry.withScope((scope) => {
    if (requestId) scope.setTag('request_id', requestId);
    if (typeof error === 'string') scope.setExtra('error_message', error);
    Sentry.captureMessage(message, 'error');
  });
}

export function installExpressErrorHandler(
  app: Parameters<typeof Sentry.setupExpressErrorHandler>[0],
) {
  if (env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
}

function stripQueryString(value: string) {
  try {
    const url = new URL(value, 'https://sentry.invalid');
    const pathname = redactSearchPath(url.pathname);
    return url.origin === 'https://sentry.invalid' ? pathname : `${url.origin}${pathname}`;
  } catch {
    return redactSearchPath(value.split(/[?#]/, 1)[0]);
  }
}

function redactSearchPath(pathname: string) {
  const segments = pathname.split('/');
  const searchIndex = segments.findIndex((segment) => /^(search|search-stream)$/i.test(segment));
  if (searchIndex >= 0 && searchIndex < segments.length - 1) {
    return `${segments.slice(0, searchIndex + 1).join('/')}/[query]`;
  }

  const productsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'products');
  if (productsIndex >= 0 && productsIndex < segments.length - 2) {
    segments[productsIndex + 2] = '[query]';
    return segments.slice(0, productsIndex + 3).join('/');
  }

  return pathname;
}
