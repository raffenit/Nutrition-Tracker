import { HttpError } from '../http/errors.js';

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new HttpError(400, 'Unknown timezone');
  }
}

export function todayLocal(timeZone: string, now = new Date()): string {
  return localDate(now.toISOString(), timeZone);
}

export function readLocalDate(value: string | null, timeZone: string): string {
  if (value && LOCAL_DATE.test(value)) return value;
  return todayLocal(timeZone);
}

export function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Monday-start week containing localDate. */
export function weekStartMonday(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  return shiftLocalDate(localDate, -daysFromMonday);
}

export function weekEndSunday(weekStart: string): string {
  return shiftLocalDate(weekStart, 6);
}

export function weekdayShort(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export function localDate(iso: string, timeZone: string): string {
  const parts = dateParts(new Date(iso), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function zonedToUtc(local: string, timeZone: string): string {
  const match = LOCAL_TIME.exec(local);
  if (!match) throw new HttpError(400, 'Choose a date and time');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const corrected = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - zoneOffsetMs(corrected, timeZone)).toISOString();
}

function dateParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = clockParts(instant, timeZone);
  const zoned = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zoned - instant.getTime();
}

function clockParts(instant: Date, timeZone: string): ClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = read('hour') === 24 ? 0 : read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
