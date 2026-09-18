type LogContext = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', message: string, context?: LogContext) {
  const entry = { level, message, ...(context ?? {}), timestamp: new Date().toISOString() };
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
    return;
  }

  const suffix = context ? ` ${JSON.stringify(context)}` : '';
  const output = `${message}${suffix}`;
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
};
