import { useEffect, useState, type CSSProperties } from 'react';
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
import { RemoveButton } from './RemoveButton';

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
  const amountOnWater = pct > 45;

  const amountText = (
    <>
      {formatVolume(amountMl, units)}
      {targetMl > 0 && <span className="muted"> / {formatVolume(targetMl, units)}</span>}
    </>
  );

  return (
    <section className="card hydration-card day-log-card" aria-label="Hydration">
      <header className="card-head">
        <div className="hydration-head-copy">
          <h2>Hydration</h2>
          {targetMl <= 0 && <p className="hydration-amount">{amountText}</p>}
        </div>
        {isToday && (
          <button
            type="button"
            className={`round-add-btn${promptAdd && entries.length === 0 ? ' cta-prompt cta-prompt-water' : ''}`}
            aria-label="Log water"
            aria-expanded={addOpen}
            onClick={() => (addOpen ? setAddOpen(false) : openAddForm())}
          >
            +
          </button>
        )}
      </header>

      <div className="hydration-card-body">
        {targetMl > 0 && (
          <div className="hydration-glass-column">
            <p className="hydration-amount hydration-amount-mobile">{amountText}</p>
            <div
              className="bar hydration-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              aria-label="Hydration progress"
              aria-valuetext={`${formatVolume(amountMl, units)} of ${formatVolume(targetMl, units)}`}
            >
              <div
                className="hydration-glass-vessel"
                style={{ '--hydration-pct': `${pct}%` } as CSSProperties}
              >
                <span className="hydration-bar-fill" aria-hidden="true" />
                <p
                  className={`hydration-amount hydration-amount-in-glass${amountOnWater ? ' hydration-amount-on-water' : ''}`}
                  aria-hidden="true"
                >
                  {amountText}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="hydration-card-stack">
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
            <p className="muted hydration-empty">{isToday ? 'No water logged yet today.' : 'No hydration logged on this day.'}</p>
          )}

          <ul className="list hydration-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span>
                  <strong>{entry.timeLabel}</strong> {entry.label} · {formatVolume(entry.amountMl, units)}
                </span>
                {onRemove && (
                  <RemoveButton
                    label={`Remove ${entry.label}`}
                    className="remove-icon-btn-water"
                    onClick={() => onRemove(entry.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
