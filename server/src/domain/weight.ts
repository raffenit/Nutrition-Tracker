export type WeightUnit = 'lb' | 'kg';

export type WeightReminder = {
  enabled: boolean;
  weekday: number;
  today: string;
  loggedWeekKey: string | null;
  dismissedWeekKey: string | null;
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function weekdayOf(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekKey(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isoWeekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoWeekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weightReminderDue(reminder: WeightReminder): boolean {
  if (!reminder.enabled) return false;
  if (!WEEKDAYS.includes(reminder.weekday)) return false;
  if (weekdayOf(reminder.today) !== reminder.weekday) return false;
  const week = weekKey(reminder.today);
  if (reminder.loggedWeekKey === week) return false;
  return reminder.dismissedWeekKey !== week;
}
