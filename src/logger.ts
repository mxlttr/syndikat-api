type LogContext = Record<string, unknown>;
type LogOptions = { captureSentry?: boolean };

import { captureErrorLog } from './services/sentryService';

function write(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: LogContext,
  options: LogOptions = {},
) {
  if (level === 'error' && options.captureSentry !== false) captureErrorLog(message, context);
  const safeContext = serializeContext(context);
  const entry = { level, message, ...(safeContext ?? {}), timestamp: new Date().toISOString() };
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
    return;
  }

  const suffix = safeContext ? ` ${JSON.stringify(safeContext)}` : '';
  const output = `${message}${suffix}`;
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

function serializeContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (!(value instanceof Error)) return [key, value];
      return [
        key,
        {
          name: value.name,
          message: value.message,
          stack: value.stack,
        },
      ];
    }),
  );
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext, options?: LogOptions) =>
    write('error', message, context, options),
};
