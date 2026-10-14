import webpush from 'web-push';
import { listAlertDismissals } from '../db/alerts.js';
import { hydrationTotal, listHydration, listMeals } from '../db/logs.js';
import {
  alertAlreadyPushed,
  getPushEnabled,
  listPushSubscriptions,
  markAlertPushed,
} from '../db/push.js';
import { getTargets } from '../db/users.js';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { buildGoalAlerts, type GoalAlert } from './alerts.js';
import { dayTotals } from './day.js';
import { DEFAULT_TARGETS } from './nutrients.js';

export function pushConfigured(config: AppConfig): boolean {
  return config.vapid !== null;
}

export async function notifyGoalAlertsAfterLog(
  db: AppDatabase,
  config: AppConfig,
  userId: string,
  localDate: string,
  timeZone: string,
): Promise<void> {
  if (!config.vapid || !getPushEnabled(db, userId)) return;
  const subscriptions = listPushSubscriptions(db, userId);
  if (subscriptions.length === 0) return;

  const logs = listMeals(db, userId, localDate, timeZone);
  const hydration = listHydration(db, userId, localDate, timeZone);
  const totals = dayTotals(logs, hydrationTotal(hydration));
  const targets = getTargets(db, userId) ?? DEFAULT_TARGETS;
  const dismissed = listAlertDismissals(db, userId, localDate);
  const alerts = buildGoalAlerts(totals, targets, dismissed);
  const toSend = alerts.filter((alert) => shouldPushAlert(db, userId, localDate, alert));
  if (toSend.length === 0) return;

  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

  for (const alert of toSend) {
    markAlertPushed(db, userId, localDate, alert.id);
    const payload = JSON.stringify({
      title: pushTitle(alert),
      body: alert.message,
      url: '/',
    });
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (error) {
        if (isGone(error)) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    }
  }
}

export function shouldPushAlert(db: AppDatabase, userId: string, localDate: string, alert: GoalAlert): boolean {
  if (alertAlreadyPushed(db, userId, localDate, alert.id)) return false;
  if (!alert.dismissible) return true;
  return alert.tone === 'warn' || alert.tone === 'success';
}

function pushTitle(alert: GoalAlert): string {
  if (alert.tone === 'danger') return 'Nutrition goal';
  if (alert.tone === 'success') return 'Nice work';
  return 'Nutrition Tracker';
}

function isGone(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
}
