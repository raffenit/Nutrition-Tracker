import type { MealLog } from '../types';

type DayLogProps = { logs: MealLog[]; onRemove?: (id: string) => void; isToday?: boolean };

export function DayLog({ logs, onRemove, isToday = true }: DayLogProps) {
  return (
    <section className="card">
      <h2>Log</h2>
      {logs.length === 0 && (
        <p className="muted">{isToday ? 'Nothing logged yet today.' : 'Nothing logged on this day.'}</p>
      )}
      <ul className="list">
        {logs.map((log) => (
          <li key={log.id}>
            <span><strong>{log.timeLabel}</strong> {label(log.slot)} · {log.name} · {Math.round(log.nutrients.calories)} kcal{log.drinkMl ? ` · ${Math.round(log.drinkMl)} ml` : ''}</span>
            {onRemove && <button type="button" onClick={() => onRemove(log.id)}>Remove</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function label(slot: MealLog['slot']): string {
  if (slot === 'meal') return 'Meal';
  if (slot === 'snack') return 'Snack';
  if (slot === 'dessert') return 'Dessert';
  return 'Drink';
}
