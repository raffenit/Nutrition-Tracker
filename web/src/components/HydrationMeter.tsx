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
  const level = targetMl > 0 ? amountMl / targetMl : 0;
  return (
    <section className="card hydration-card">
      <h2>Hydration</h2>
      <p>{formatVolume(amountMl, units)} of {formatVolume(targetMl, units)}</p>
      <div className="glasses" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="glass" key={index}><i style={{ height: `${glassFill(level, index) * 100}%` }} /></div>
        ))}
      </div>
      <p className="muted">Drinks in today&apos;s log count here too.</p>
      <div className="row tight">
        <button type="button" onClick={onRemove}>{removeGlassLabel(units)}</button>
        <button type="button" className="primary" onClick={onAdd}>{glassLabel(units)}</button>
      </div>
    </section>
  );
}

function glassFill(level: number, index: number): number {
  const start = index / 8;
  const end = (index + 1) / 8;
  if (level >= end) return 1;
  if (level <= start) return 0;
  return (level - start) / (end - start);
}
