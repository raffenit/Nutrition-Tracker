import type { DayTotals } from '../types';

type MacroPieChartProps = { totals: DayTotals };

const LEGEND = [
  { key: 'protein' as const, label: 'Protein', color: 'var(--protein)' },
  { key: 'fat' as const, label: 'Fat', color: 'var(--fat)' },
  { key: 'carbs' as const, label: 'Carbs', color: 'var(--carb)' },
];

export function MacroPieChart({ totals }: MacroPieChartProps) {
  const shares = totals.shares;
  const empty = shares.protein + shares.fat + shares.carbs <= 0;
  const gradient = empty
    ? 'conic-gradient(var(--line) 0 100%)'
    : `conic-gradient(
      var(--protein) 0 ${shares.protein * 100}%,
      var(--fat) ${shares.protein * 100}% ${(shares.protein + shares.fat) * 100}%,
      var(--carb) ${(shares.protein + shares.fat) * 100}% 100%
    )`;

  return (
    <section className="card macro-pie">
      <h2>Macros</h2>
      <div className="pie-wrap">
        <div className="pie" style={{ background: gradient }} aria-hidden="true">
          <div className="pie-hole">
            <strong>{Math.round(totals.calories)}</strong>
            <span className="muted">kcal</span>
          </div>
        </div>
        <ul className="pie-legend">
          {LEGEND.map((item) => (
            <li key={item.key}>
              <span className="swatch" style={{ background: item.color }} />
              {item.label} {Math.round(shares[item.key] * 100)}%
            </li>
          ))}
        </ul>
      </div>
      <p className="muted">Calorie split from protein, fat, and carbs logged today.</p>
    </section>
  );
}
