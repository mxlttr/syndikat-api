import type { ZodObject, ZodRawShape } from 'zod';
import { ZodError } from 'zod';
import { logger } from './logger';

export default function tryParseEnv<T extends ZodRawShape>(
  EnvSchema: ZodObject<T>,
  buildEnv: Record<string, string | undefined> = process.env,
) {
  try {
    EnvSchema.parse(buildEnv);
  } catch (error) {
    if (error instanceof ZodError) {
      let message = 'Missing required values in .env:\n';
      error.issues.forEach((issue) => {
        message += `${String(issue.path[0])}\n`;
      });
      const e = new Error(message);
      e.stack = '';
      throw e;
    } else {
      logger.error('Environment validation failed unexpectedly', { error: String(error) });
    }
  }
}

export function getCell(element: cheerio.Cheerio, number?: false): string;
export function getCell(element: cheerio.Cheerio, number: true): number;

export function getCell(element: cheerio.Cheerio, number = false): string | number {
  const text = element.text().trim();

  if (number) {
    const num = Number(text.replace(/\D/g, ''));
    return Number.isNaN(num) ? 0 : num;
  }

  return text;
}

export function formatBahnTravelDate(date?: string): string | null {
  const trimmedDate = date?.trim();
  if (!trimmedDate) {
    return null;
  }

  const dateOnlyMatch = trimmedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const parsedDate = new Date(Number(year), Number(month) - 1, Number(day), 8, 0, 0);
    return isWithinNextSixMonths(parsedDate) ? formatBahnDateTime(parsedDate) : null;
  }

  const parsedDate = new Date(trimmedDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const normalizedDate = new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    8,
    0,
    0,
  );

  return isWithinNextSixMonths(normalizedDate) ? formatBahnDateTime(normalizedDate) : null;
}

function formatBahnDateTime(date: Date): string {
  return [date.getFullYear(), padDatePart(date.getMonth() + 1), padDatePart(date.getDate())]
    .join('-')
    .concat('T08:00:00');
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, '0');
}

function isWithinNextSixMonths(date: Date): boolean {
  const now = new Date();
  const sixMonthsAhead = new Date(now);
  sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);

  return date > now && date < sixMonthsAhead;
}
