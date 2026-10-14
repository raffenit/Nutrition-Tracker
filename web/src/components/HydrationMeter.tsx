import type { Units } from '../units';
import { formatVolume, glassLabel, removeGlassLabel } from '../units';

type HydrationMeterProps = {
  amountMl: number;
  targetMl: number;
  units: Units;
  onAdd: () => void;
  onRemove: () => void;
};

export function HydrationMeter({ amountMl, targetMl, units, onAdd, onRemove }: HydrationMeterProps) {
  const pct = targetMl > 0 ? Math.min(amountMl / targetMl, 1) * 100 : 0;
  return (
    <section className="card hydration-card" aria-label="Hydration">
      <div className="hydration-head">
        <div className="hydration-copy">
          <h2>Hydration</h2>
          <p className="hydration-amount">
            {formatVolume(amountMl, units)}
            {targetMl > 0 && <span className="muted"> / {formatVolume(targetMl, units)}</span>}
          </p>
        </div>
        <div className="hydration-stepper" role="group" aria-label="Adjust water">
          <button type="button" className="hydration-step" aria-label={removeGlassLabel(units)} onClick={onRemove}>
            −
          </button>
          <button type="button" className="hydration-step hydration-step-add" aria-label={glassLabel(units)} onClick={onAdd}>
            +
          </button>
        </div>
      </div>
      {targetMl > 0 && (
        <div className="bar hydration-bar">
          <span style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--water), var(--water-deep))' }} />
        </div>
      )}
    </section>
  );
}
