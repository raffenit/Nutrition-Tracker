import type { DayTotals, Targets } from '../types';
import { formatAmount } from '../nav';

const ROWS = [
  { key: 'calories', label: 'Calories', unit: '', color: 'var(--text)' },
  { key: 'protein', label: 'Protein', unit: 'g', color: 'var(--protein)' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: 'var(--fiber)' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'var(--fat)' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: 'var(--carb)' },
] as const;

type MacroBarsProps = { totals: DayTotals; targets: Targets };

export function MacroBars({ totals, targets }: MacroBarsProps) {
  return (
    <section className="card">
      <h2>Today</h2>
      {ROWS.map((row) => (
        <MacroRow key={row.key} label={row.label} amount={totals[row.key]} target={targets[row.key]} unit={row.unit} color={row.color} />
      ))}
      {targets.sodium !== null && (
        <MacroRow label="Sodium" amount={totals.sodium} target={targets.sodium} unit="mg" color="var(--muted)" />
      )}
      <div className="share" aria-label="Calorie share from protein, fat, and carbs">
        <span style={{ width: `${totals.shares.protein * 100}%`, background: 'var(--protein)' }} />
        <span style={{ width: `${totals.shares.fat * 100}%`, background: 'var(--fat)' }} />
        <span style={{ width: `${totals.shares.carbs * 100}%`, background: 'var(--carb)' }} />
      </div>
      <p className="muted">Share of calories from protein, fat, and carbs. Fiber is shown in grams.</p>
    </section>
  );
}

function MacroRow({ label, amount, target, unit, color }: { label: string; amount: number; target: number | null; unit: string; color: string }) {
  const width = target && target > 0 ? Math.min(amount / target, 1) * 100 : 0;
  return (
    <div>
      <div className="row"><strong>{label}</strong><span>{formatAmount(amount, unit)}{target ? ` / ${formatAmount(target, unit)}` : ''}</span></div>
      <div className="bar"><span style={{ width: `${width}%`, background: color }} /></div>
    </div>
  );
}
