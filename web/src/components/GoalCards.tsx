import { formatAmount } from '../nav';
import type { DayTotals, Targets } from '../types';

type Goal = {
  key: string;
  label: string;
  amount: number;
  target: number;
  unit: string;
  color: string;
};

type GoalCardsProps = { totals: DayTotals; targets: Targets };

const CORE: Array<{ key: keyof Targets; label: string; unit: string; color: string; optional?: boolean }> = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: 'var(--accent-soft)' },
  { key: 'protein', label: 'Protein', unit: 'g', color: 'var(--protein)' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: 'var(--fiber)' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'var(--fat)' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: 'var(--carb)' },
];

export function GoalCards({ totals, targets }: GoalCardsProps) {
  const goals = buildGoals(totals, targets);
  if (goals.length === 0) return null;
  return (
    <section className="goal-cards" aria-label="Nutrient goals">
      {goals.map((goal) => (
        <article className="goal-card card" key={goal.key}>
          <header className="goal-head">
            <strong>{goal.label}</strong>
            <span>{formatAmount(goal.amount, goal.unit)} / {formatAmount(goal.target, goal.unit)}</span>
          </header>
          <div className="bar"><span style={{ width: `${progress(goal.amount, goal.target)}%`, background: goal.color }} /></div>
        </article>
      ))}
    </section>
  );
}

function buildGoals(totals: DayTotals, targets: Targets): Goal[] {
  const goals: Goal[] = [];
  for (const row of CORE) {
    if (row.key === 'sodium' || row.key === 'hydrationMl' || row.key === 'units' || row.key === 'extras') continue;
    const target = targets[row.key] as number;
    if (target <= 0) continue;
    goals.push({
      key: row.key,
      label: row.label,
      amount: totals[row.key as keyof DayTotals] as number,
      target,
      unit: row.unit,
      color: row.color,
    });
  }
  if (targets.sodium !== null && targets.sodium > 0) {
    goals.push({
      key: 'sodium',
      label: 'Sodium',
      amount: totals.sodium,
      target: targets.sodium,
      unit: 'mg',
      color: 'var(--muted)',
    });
  }
  for (const extra of targets.extras) {
    if (extra.amount <= 0) continue;
    const logged = totals.extras.find((item) => item.key === extra.key)?.amount ?? 0;
    goals.push({
      key: extra.key,
      label: extra.label,
      amount: logged,
      target: extra.amount,
      unit: extra.unit,
      color: 'var(--accent-soft)',
    });
  }
  return goals;
}

function progress(amount: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(amount / target, 1) * 100;
}
