import { shiftDate } from './nav';

/** Monday-start week containing localDate (YYYY-MM-DD). */
export function weekStartMonday(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  return shiftDate(localDate, -daysFromMonday);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
}

export function weekEndSunday(weekStart: string): string {
  return shiftDate(weekStart, 6);
}
