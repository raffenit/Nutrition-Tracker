import type { AppDatabase } from './database.js';

export function listAlertDismissals(db: AppDatabase, userId: string, localDate: string): Set<string> {
  const rows = db.prepare(
    `SELECT alert_key FROM alert_dismissals WHERE user_id = ? AND local_date = ?`,
  ).all(userId, localDate) as Array<{ alert_key: string }>;
  return new Set(rows.map((row) => row.alert_key));
}

export function dismissAlert(db: AppDatabase, userId: string, localDate: string, alertKey: string): void {
  db.prepare(
    `INSERT INTO alert_dismissals (user_id, local_date, alert_key) VALUES (?, ?, ?)
     ON CONFLICT(user_id, local_date, alert_key) DO NOTHING`,
  ).run(userId, localDate, alertKey);
}
