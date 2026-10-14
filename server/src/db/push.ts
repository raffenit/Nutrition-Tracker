import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database.js';

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function getPushEnabled(db: AppDatabase, userId: string): boolean {
  const row = db.prepare('SELECT enabled FROM push_preferences WHERE user_id = ?').get(userId) as { enabled: number } | undefined;
  return row?.enabled === 1;
}

export function setPushEnabled(db: AppDatabase, userId: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO push_preferences (user_id, enabled) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled`,
  ).run(userId, enabled ? 1 : 0);
}

export function upsertPushSubscription(
  db: AppDatabase,
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): void {
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(randomUUID(), userId, sub.endpoint, sub.p256dh, sub.auth, new Date().toISOString());
}

export function deletePushSubscription(db: AppDatabase, userId: string, endpoint: string): boolean {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes > 0;
}

export function deletePushSubscriptionsForUser(db: AppDatabase, userId: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
}

export function listPushSubscriptions(db: AppDatabase, userId: string): PushSubscriptionRow[] {
  const rows = db.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
  ).all(userId) as PushSubscriptionRow[];
  return rows;
}

export function markAlertPushed(db: AppDatabase, userId: string, localDate: string, alertKey: string): void {
  db.prepare(
    `INSERT INTO alert_push_sent (user_id, local_date, alert_key) VALUES (?, ?, ?)
     ON CONFLICT(user_id, local_date, alert_key) DO NOTHING`,
  ).run(userId, localDate, alertKey);
}

export function alertAlreadyPushed(db: AppDatabase, userId: string, localDate: string, alertKey: string): boolean {
  const row = db.prepare(
    'SELECT 1 AS found FROM alert_push_sent WHERE user_id = ? AND local_date = ? AND alert_key = ?',
  ).get(userId, localDate, alertKey) as { found: number } | undefined;
  return Boolean(row);
}
