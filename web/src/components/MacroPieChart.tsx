import { useId, useState } from 'react';
import { ceilingStatus, nutrientIsCeiling } from '../goalCeiling';
import { GoalCards, hasGoalCards } from './GoalCards';
import type { DayTotals, Targets } from '../types';

type MacroPieChartProps = {
  totals: DayTotals;
  targets?: Targets;
};

const LEGEND = [
  { key: 'protein' as const, label: 'Protein', color: 'var(--protein)' },
  { key: 'fat' as const, label: 'Fat', color: 'var(--fat)' },
  { key: 'carbs' as const, label: 'Carbs', color: 'var(--carb)' },
];

export function MacroPieChart({ totals, targets }: MacroPieChartProps) {
  const [goalsOpen, setGoalsOpen] = useState(false);
  const drawerId = useId();
  const shares = totals.shares;
  const empty = shares.protein + shares.fat + shares.carbs <= 0;
  const gradient = empty
    ? 'conic-gradient(var(--line) 0 100%)'
    : `conic-gradient(
      var(--protein) 0 ${shares.protein * 100}%,
      var(--fat) ${shares.protein * 100}% ${(shares.protein + shares.fat) * 100}%,
      var(--carb) ${(shares.protein + shares.fat) * 100}% 100%
    )`;
  const goalsAvailable = Boolean(targets && hasGoalCards(targets));
  const calorieStatus = targets && nutrientIsCeiling('calories', targets)
    ? ceilingStatus(totals.calories, targets.calories, true)
    : 'ok';

  function macroLegendStatus(key: 'protein' | 'fat' | 'carbs'): 'ok' | 'near' | 'over' {
    if (!targets || !nutrientIsCeiling(key, targets)) return 'ok';
    const target = targets[key];
    return ceilingStatus(totals[key], target, true);
  }

  return (
    <section className="card macro-pie">
      <header className="card-head">
        <h2>Macros</h2>
        {goalsAvailable && (
          <button
            type="button"
            className="macro-goals-toggle"
            aria-expanded={goalsOpen}
            aria-controls={drawerId}
            onClick={() => setGoalsOpen((open) => !open)}
          >
            {goalsOpen ? 'Hide goals' : 'Goals'}
          </button>
        )}
      </header>
      <div className="macro-pie-body">
        <div className="pie-wrap">
          <div className="pie" style={{ background: gradient }} aria-hidden="true">
            <div className={`pie-hole${calorieStatus !== 'ok' ? ` macro-${calorieStatus}` : ''}`}>
              <strong>{Math.round(totals.calories)}</strong>
              <span className="muted">kcal</span>
            </div>
          </div>
          <ul className="pie-legend">
            {LEGEND.map((item) => {
              const status = macroLegendStatus(item.key);
              return (
                <li key={item.key} className={status !== 'ok' ? `macro-${status}` : undefined}>
                  <span className="swatch" style={{ background: item.color }} />
                  {item.label} {Math.round(shares[item.key] * 100)}%
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {!goalsAvailable && (
        <p className="muted macro-pie-caption">Calorie split from protein, fat, and carbs logged today.</p>
      )}
      {goalsAvailable && targets && goalsOpen && (
        <div className="macro-goals-drawer" id={drawerId}>
          <GoalCards totals={totals} targets={targets} />
        </div>
      )}
    </section>
  );
}
