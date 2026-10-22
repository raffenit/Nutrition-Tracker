import { useEffect, useState } from 'react';
import {
  defaultVolumeLogUnit,
  formatVolume,
  mlToVolumeLogInput,
  type Units,
  VOLUME_LOG_UNITS,
  volumeLogInputToMl,
  volumeLogUnitLabel,
  type VolumeLogUnit,
} from '../units';
import type { HydrationEntry } from '../types';

type HydrationMeterProps = {
  entries: HydrationEntry[];
  amountMl: number;
  targetMl: number;
  units: Units;
  defaultAmountMl: number;
  isToday: boolean;
  promptAdd?: boolean;
  onAdd: (amountMl: number) => void;
  onRemove?: (id: string) => void;
};

export function HydrationMeter({
  entries,
  amountMl,
  targetMl,
  units,
  defaultAmountMl,
  isToday,
  promptAdd = false,
  onAdd,
  onRemove,
}: HydrationMeterProps) {
  const pct = targetMl > 0 ? Math.min(amountMl / targetMl, 1) * 100 : 0;
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [volumeUnit, setVolumeUnit] = useState<VolumeLogUnit>(() => defaultVolumeLogUnit(units));

  useEffect(() => {
    setVolumeUnit(defaultVolumeLogUnit(units));
  }, [units]);

  function openAddForm(): void {
    const unit = defaultVolumeLogUnit(units);
    setVolumeUnit(unit);
    setAmount(String(mlToVolumeLogInput(defaultAmountMl, unit)));
    setAddOpen(true);
  }

  function submitAdd(): void {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const amountMlNext = volumeLogInputToMl(parsed, volumeUnit);
    if (amountMlNext <= 0) return;
    onAdd(amountMlNext);
    setAddOpen(false);
  }

  const showEmpty = entries.length === 0;

  return (
    <section className="card hydration-card day-log-card" aria-label="Hydration">
      <header className="card-head">
        <div className="hydration-head-copy">
          <h2>Hydration</h2>
          <p className="hydration-amount">
            {formatVolume(amountMl, units)}
            {targetMl > 0 && <span className="muted"> / {formatVolume(targetMl, units)}</span>}
          </p>
        </div>
        {isToday && (
          <button
            type="button"
            className={`round-add-btn${promptAdd && entries.length === 0 ? ' cta-prompt' : ''}`}
            aria-label="Log water"
            aria-expanded={addOpen}
            onClick={() => (addOpen ? setAddOpen(false) : openAddForm())}
          >
            +
          </button>
        )}
      </header>

      {targetMl > 0 && (
        <div className="bar hydration-bar">
          <span style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--water), var(--water-deep))' }} />
        </div>
      )}

      {addOpen && isToday && (
        <form
          className="hydration-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitAdd();
          }}
        >
          <label className="hydration-add-field">
            <span className="sr-only">Amount</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="any"
              value={amount}
              required
              autoFocus
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="hydration-add-field hydration-add-unit">
            <span className="sr-only">Unit</span>
            <select
              value={volumeUnit}
              onChange={(event) => setVolumeUnit(event.target.value as VolumeLogUnit)}
            >
              {VOLUME_LOG_UNITS.map((unit) => (
                <option key={unit} value={unit}>{volumeLogUnitLabel(unit)}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary hydration-add-submit">Add</button>
        </form>
      )}

      {showEmpty && !addOpen && (
        <p className="muted">{isToday ? 'No water logged yet today.' : 'No hydration logged on this day.'}</p>
      )}

      <ul className="list hydration-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>
              <strong>{entry.timeLabel}</strong> {entry.label} · {formatVolume(entry.amountMl, units)}
            </span>
            {onRemove && <button type="button" onClick={() => onRemove(entry.id)}>Remove</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
