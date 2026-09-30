import type { MealSlot } from '../types';

export type FamilyMemberInsights = {
  hasGoals: boolean;
  goalDays: { met: number; daysInMonth: number; monthLabel: string };
  usualMealTimes: Array<{ slot: MealSlot; timeLabel: string; count: number }>;
  selectedDayMetGoals: boolean;
};

type Member = {
  user: { name: string };
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

  return (
    <section className="card family-summary" aria-label="Household insights">
      <h2 className="family-summary-title">This month</h2>
      <ul className="family-insights-list">
        {members.map((member) => (
          <li className="family-insight-row" key={member.user.name}>
            <strong className="family-insight-name">{member.user.name}</strong>
            <div className="family-insight-lines">
              <p>{goalDaysLine(member)}</p>
              {member.insights.usualMealTimes.length > 0 ? (
                <p className="muted family-insight-meals">
                  Usual times:{' '}
                  {member.insights.usualMealTimes
                    .map((row) => `${SLOT_LABEL[row.slot]} ~${row.timeLabel}`)
                    .join(' · ')}
                </p>
              ) : (
                <p className="muted">No meal logs yet this month.</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function goalDaysLine(member: Member): string {
  const { hasGoals, goalDays } = member.insights;
  const { met, daysInMonth, monthLabel } = goalDays;
  if (!hasGoals) return 'No daily goals set in Settings yet.';
  if (daysInMonth <= 0) return 'No days to summarize yet.';
  return `Met health goals ${met}/${daysInMonth} days so far in ${monthLabel}.`;
}
