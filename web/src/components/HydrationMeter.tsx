type HydrationMeterProps = {
  amountMl: number;
  targetMl: number;
  onAdd: () => void;
  onRemove: () => void;
};

export function HydrationMeter({ amountMl, targetMl, onAdd, onRemove }: HydrationMeterProps) {
  const level = targetMl > 0 ? amountMl / targetMl : 0;
  return (
    <section className="card">
      <h2>Hydration</h2>
      <p>{liters(amountMl)} of {liters(targetMl)}</p>
      <div className="glasses" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="glass" key={index}><i style={{ height: `${glassFill(level, index) * 100}%` }} /></div>
        ))}
      </div>
      <p className="muted">Drinks in today's log count here too.</p>
      <div className="row">
        <button type="button" onClick={onRemove}>Remove glass</button>
        <button type="button" className="primary" onClick={onAdd}>Add glass</button>
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

function liters(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`;
}
