import type { AppDatabase } from '../db/database.js';
import { dismissedWeek, getWeightPreference, latestWeightDate, listWeightEntries } from '../db/weight.js';
import { weekKey, weightReminderDue } from '../domain/weight.js';

export function personalWeight(db: AppDatabase, userId: string, today: string) {
  const preference = getWeightPreference(db, userId);
  if (!preference.enabled) return { enabled: false as const };
  const week = weekKey(today);
  const latest = latestWeightDate(db, userId);
  return {
    enabled: true as const,
    weekday: preference.weekday,
    unit: preference.unit,
    reminderDue: weightReminderDue({
      enabled: true,
      weekday: preference.weekday,
      today,
      loggedWeekKey: latest ? weekKey(latest) : null,
      dismissedWeekKey: dismissedWeek(db, userId, week) ? week : null,
    }),
    entries: listWeightEntries(db, userId),
  };
}
