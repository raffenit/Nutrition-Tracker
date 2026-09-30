import { formatVolume, type Units } from '../units';
import type { DayTotals, Targets } from '../types';

type Member = {
  user: { name: string };
  units: Units;
  targets: Pick<Targets, 'calories' | 'protein' | 'hydrationMl'>;
  totals: DayTotals;
  logs: unknown[];
};

type FamilySummaryProps = {
  members: Member[];
  displayUnits: Units;
};

export function FamilySummary({ members, displayUnits }: FamilySummaryProps) {
  if (members.length === 0) return null;

  const calories = members.reduce((sum, member) => sum + member.totals.calories, 0);
  const protein = members.reduce((sum, member) => sum + member.totals.protein, 0);
  const hydrationMl = members.reduce((sum, member) => sum + member.totals.hydrationMl, 0);
  const entries = members.reduce((sum, member) => sum + member.logs.length, 0);
  const logging = members.filter((member) => member.logs.length > 0).length;
  const calorieGoal = members.reduce((sum, member) => sum + member.targets.calories, 0);
  const proteinGoal = members.reduce((sum, member) => sum + member.targets.protein, 0);

  return (
    <section className="card family-summary" aria-label="Household summary">
      <h2 className="family-summary-title">Household totals</h2>
      <div className="family-summary-grid">
        <Stat label="Calories" value={`${Math.round(calories)} kcal`} hint={calorieGoal > 0 ? `${Math.round((calories / calorieGoal) * 100)}% of combined goals` : undefined} />
        <Stat label="Protein" value={`${Math.round(protein)} g`} hint={proteinGoal > 0 ? `${Math.round((protein / proteinGoal) * 100)}% of combined goals` : undefined} />
        <Stat label="Hydration" value={formatVolume(hydrationMl, displayUnits)} />
        <Stat label="Logged" value={`${logging}/${members.length}`} hint={`${entries} ${entries === 1 ? 'entry' : 'entries'}`} />
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="family-stat">
      <span className="family-stat-label">{label}</span>
      <strong className="family-stat-value">{value}</strong>
      {hint && <span className="family-stat-hint muted">{hint}</span>}
    </article>
  );
}
