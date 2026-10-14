import { ceilingStatus, nutrientIsCeiling } from '../goalCeiling';
import { formatAmount } from '../nav';
import type { DayTotals, Targets } from '../types';

type Goal = {
  key: string;
  label: string;
  amount: number;
  target: number;
  unit: string;
  color: string;
  isLimit: boolean;
  isCeiling: boolean;
};

type GoalCardsProps = { totals: DayTotals; targets: Targets };

const CORE: Array<{ key: keyof Targets; label: string; unit: string; color: string }> = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: 'var(--calories)' },
  { key: 'protein', label: 'Protein', unit: 'g', color: 'var(--protein)' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: 'var(--fiber)' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'var(--fat)' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: 'var(--carb)' },
];

const EMPTY_TOTALS: DayTotals = {
  calories: 0,
  protein: 0,
  fiber: 0,
  fat: 0,
  carbs: 0,
  sodium: 0,
  extras: [],
  hydrationMl: 0,
  shares: { protein: 0, fat: 0, carbs: 0 },
};

export function hasGoalCards(targets: Targets): boolean {
  return buildGoals(EMPTY_TOTALS, targets).length > 0;
}

export function GoalCards({ totals, targets }: GoalCardsProps) {
  const goals = buildGoals(totals, targets);
  if (goals.length === 0) return null;
  return (
    <section className="goal-cards" aria-label="Nutrient goals">
      {goals.map((goal) => {
        const status = ceilingStatus(goal.amount, goal.target, goal.isCeiling);
        return (
          <article className={`goal-card card${status === 'over' ? ' goal-over' : status === 'near' ? ' goal-near' : ''}`} key={goal.key}>
            <header className="goal-head">
              <strong>{goal.label}</strong>
              <span>
                {formatAmount(goal.amount, goal.unit)} / {goal.isLimit ? '≤' : ''}{formatAmount(goal.target, goal.unit)}
              </span>
            </header>
            <div className="bar"><span style={{ width: `${progress(goal.amount, goal.target)}%`, background: goal.color }} /></div>
          </article>
        );
      })}
    </section>
  );
}

function buildGoals(totals: DayTotals, targets: Targets): Goal[] {
  const goals: Goal[] = [];
  for (const row of CORE) {
    if (row.key === 'sodium' || row.key === 'hydrationMl' || row.key === 'units' || row.key === 'extras') continue;
    if (row.key === 'sodiumIsLimit' || row.key === 'carbsIsLimit' || row.key === 'dateFormat') continue;
    const target = targets[row.key] as number;
    if (target <= 0) continue;
    const key = row.key as string;
    goals.push({
      key,
      label: row.label,
      amount: totals[row.key as keyof DayTotals] as number,
      target,
      unit: row.unit,
      color: row.color,
      isLimit: key === 'carbs' && targets.carbsIsLimit,
      isCeiling: nutrientIsCeiling(key, targets),
    });
  }
  if (targets.sodium !== null && targets.sodium > 0) {
    goals.push({
      key: 'sodium',
      label: 'Sodium',
      amount: totals.sodium,
      target: targets.sodium,
      unit: 'mg',
      color: 'var(--sodium)',
      isLimit: targets.sodiumIsLimit,
      isCeiling: nutrientIsCeiling('sodium', targets),
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
      color: 'var(--accent-warm)',
      isLimit: false,
      isCeiling: false,
    });
  }
  return goals;
}

function progress(amount: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(amount / target, 1) * 100;
}
