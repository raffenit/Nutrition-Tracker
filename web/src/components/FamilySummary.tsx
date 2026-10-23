import type { DayTotals, MealSlot, Targets } from '../types';

export type FamilyMemberInsights = {
  hasGoals: boolean;
  goalDays: { met: number; daysInMonth: number; monthLabel: string };
  usualMealTimes: Array<{ slot: MealSlot; timeLabel: string; count: number }>;
  selectedDayMetGoals: boolean;
};

type Member = {
  user: { name: string };
  totals: DayTotals;
  targets: Pick<Targets, 'calories' | 'protein' | 'hydrationMl'>;
  insights: FamilyMemberInsights;
};

type FamilySummaryProps = {
  members: Member[];
};

const SLOT_LABEL: Record<MealSlot, string> = {
  meal: 'Meals',
  snack: 'Snacks',
  dessert: 'Desserts',
  drink: 'Drinks',
};

export function FamilySummary({ members }: FamilySummaryProps) {
  if (members.length === 0) return null;

  const withGoals = members.filter((member) => member.insights.hasGoals);
  const metToday = withGoals.filter((member) => member.insights.selectedDayMetGoals).length;

  return (
    <section className="card family-summary" aria-label="Household day overview">
      <h2 className="family-summary-title">Today</h2>
      <div className="family-day-chart">
        {members.map((member) => (
          <FamilyDayBar key={member.user.name} member={member} />
        ))}
      </div>
      {withGoals.length > 0 && (
        <p className="muted family-summary-foot">
          {metToday} of {withGoals.length} met daily goals on this day
        </p>
      )}
    </section>
  );
}

function FamilyDayBar({ member }: { member: Member }) {
  const target = member.targets.calories;
  const amount = member.totals.calories;
  const pct = target > 0 ? Math.min(amount / target, 1) * 100 : 0;
  const status =
    !member.insights.hasGoals || target <= 0
      ? 'none'
      : member.insights.selectedDayMetGoals
        ? 'met'
        : pct >= 85
          ? 'near'
          : 'ok';

  return (
    <div className="family-day-bar-row">
      <span className="family-day-bar-name">{member.user.name}</span>
      <div className="family-day-bar-track bar" aria-hidden="true">
        <span
          className={`family-day-bar-fill family-day-bar-fill--${status}`}
          style={{ width: target > 0 ? `${pct}%` : '0%', background: 'var(--calories)' }}
        />
      </div>
      <span className="family-day-bar-val">
        {Math.round(amount)}
        {target > 0 ? ` / ${Math.round(target)}` : ''} kcal
      </span>
    </div>
  );
}

export function memberMonthGoalLine(member: Member): string {
  return goalDaysLine(member);
}

export function memberUsualMealsLine(member: Member): string | null {
  if (member.insights.usualMealTimes.length === 0) return null;
  return member.insights.usualMealTimes
    .map((row) => `${SLOT_LABEL[row.slot]} ~${row.timeLabel}`)
    .join(' · ');
}

function goalDaysLine(member: Member): string {
  const { hasGoals, goalDays } = member.insights;
  const { met, daysInMonth, monthLabel } = goalDays;
  if (!hasGoals) return 'No daily goals set in Settings yet.';
  if (daysInMonth <= 0) return 'No days to summarize yet.';
  return `Met health goals ${met}/${daysInMonth} days in ${monthLabel}`;
}
