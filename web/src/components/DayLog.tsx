import { navigate } from '../nav';
import type { MealLog } from '../types';
import { RemoveButton } from './RemoveButton';

type DayLogProps = { logs: MealLog[]; onRemove?: (id: string) => void; isToday?: boolean };

export function DayLog({ logs, onRemove, isToday = true }: DayLogProps) {
  return (
    <section className="card day-log-card" aria-label="Meals">
      <header className="card-head">
        <h2>Meals</h2>
        <button
          type="button"
          className={`round-add-btn${logs.length === 0 && isToday ? ' cta-prompt' : ''}`}
          aria-label="Log food or drink"
          onClick={() => navigate('/add')}
        >
          +
        </button>
      </header>
      {logs.length === 0 && (
        <p className="muted">{isToday ? 'Nothing logged yet today.' : 'Nothing logged on this day.'}</p>
      )}
      <ul className="list">
        {logs.map((log) => (
          <li key={log.id}>
            <span><strong>{log.timeLabel}</strong> {label(log.slot)} · {log.name} · {Math.round(log.nutrients.calories)} kcal{log.drinkMl ? ` · ${Math.round(log.drinkMl)} ml` : ''}</span>
            {onRemove && (
              <RemoveButton label={`Remove ${log.name}`} onClick={() => onRemove(log.id)} />
            )}
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
