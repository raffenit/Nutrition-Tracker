import type { DayTotals, Targets } from '../types.js';

export type GoalAlert = {
  id: string;
  tone: 'warn' | 'danger' | 'success';
  message: string;
  dismissible: boolean;
};

const SOFT_RATIO = 0.9;

export function buildGoalAlerts(totals: DayTotals, targets: Targets, dismissed: ReadonlySet<string>): GoalAlert[] {
  const alerts: GoalAlert[] = [];
  if (targets.calories > 0) {
    const ratio = totals.calories / targets.calories;
    if (ratio > 1) {
      alerts.push({
        id: 'calories-hard',
        tone: 'danger',
        message: `You're over today's calorie goal (${Math.round(totals.calories)} / ${Math.round(targets.calories)} kcal).`,
        dismissible: false,
      });
    } else if (ratio >= SOFT_RATIO) {
      alerts.push({
        id: 'calories-soft',
        tone: 'warn',
        message: `You're close to today's calorie goal (${Math.round(totals.calories)} / ${Math.round(targets.calories)} kcal).`,
        dismissible: true,
      });
    }
  }
  if (targets.sodium !== null && targets.sodium > 0) {
    const ratio = totals.sodium / targets.sodium;
    const label = targets.sodiumIsLimit ? 'sodium limit' : 'sodium goal';
    if (targets.sodiumIsLimit && ratio > 1) {
      alerts.push({
        id: 'sodium-hard',
        tone: 'danger',
        message: `You're over today's ${label} (${Math.round(totals.sodium)} / ${Math.round(targets.sodium)} mg).`,
        dismissible: false,
      });
    } else if (ratio >= SOFT_RATIO) {
      alerts.push({
        id: 'sodium-soft',
        tone: 'warn',
        message: `You're close to today's ${label} (${Math.round(totals.sodium)} / ${Math.round(targets.sodium)} mg).`,
        dismissible: true,
      });
    }
  }
  if (targets.protein > 0 && totals.protein >= targets.protein) {
    alerts.push({
      id: 'protein-celebration',
      tone: 'success',
      message: `Protein goal reached (${Math.round(totals.protein)} g).`,
      dismissible: true,
    });
  }
  for (const extra of targets.extras) {
    if (extra.amount <= 0) continue;
    const logged = totals.extras.find((item) => item.key === extra.key)?.amount ?? 0;
    if (logged >= extra.amount) {
      alerts.push({
        id: `extra-${extra.key}-celebration`,
        tone: 'success',
        message: `${extra.label} goal reached.`,
        dismissible: true,
      });
    }
  }
  return alerts.filter((alert) => !alert.dismissible || !dismissed.has(alert.id));
}
