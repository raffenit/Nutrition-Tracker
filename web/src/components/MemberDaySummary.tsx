import { formatVolume, type Units } from '../units';
import type { DayTotals, Targets } from '../types';

type MemberDaySummaryProps = {
  totals: DayTotals;
  targets: Pick<Targets, 'calories' | 'protein' | 'hydrationMl'>;
  units: Units;
};

export function MemberDaySummary({ totals, targets, units }: MemberDaySummaryProps) {
  return (
    <div className="member-stats">
      <MiniBar label="Cal" amount={totals.calories} target={targets.calories} unit="kcal" color="var(--calories)" />
      <MiniBar label="Protein" amount={totals.protein} target={targets.protein} unit="g" color="var(--protein)" />
      <p className="member-stats-line muted">
        {formatVolume(totals.hydrationMl, units)}
        {targets.hydrationMl > 0 ? ` · ${Math.round((totals.hydrationMl / targets.hydrationMl) * 100)}% hydration goal` : ''}
      </p>
    </div>
  );
}

function MiniBar({ label, amount, target, unit, color }: { label: string; amount: number; target: number; unit: string; color: string }) {
  const pct = target > 0 ? Math.min(amount / target, 1) * 100 : 0;
  return (
    <div className="member-mini">
      <div className="member-mini-head">
        <span>{label}</span>
        <span>{Math.round(amount)} / {Math.round(target)} {unit}</span>
      </div>
      <div className="bar"><span style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}
