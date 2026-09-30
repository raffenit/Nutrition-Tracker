import { useState } from 'react';
import { formatVolume, type Units } from '../units';

export type TrendDay = {
  date: string;
  weekday: string;
  calories: number;
  protein: number;
  hydrationMl: number;
};

export type TrendWeightPoint = {
  date: string;
  weight: number;
  unit: 'lb' | 'kg';
};

type TrendsPanelProps = {
  trends: { days: number; endDate: string; points: TrendDay[]; weight: TrendWeightPoint[] };
  units: Units;
  weightEnabled: boolean;
  onDaysChange: (days: number) => void;
};

const RANGES = [7, 14] as const;

export function TrendsPanel({ trends, units, weightEnabled, onDaysChange }: TrendsPanelProps) {
  const [metric, setMetric] = useState<'calories' | 'protein' | 'hydration'>('calories');
  const values = trends.points.map((point) => valueFor(point, metric));
  const max = Math.max(...values, 1);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

  return (
    <section className={`card trends trends-panel${metric === 'hydration' ? ' metric-hydration' : ''}`}>
      <div className="row trends-head">
        <h2>Trends</h2>
        <div className="segmented compact" role="group" aria-label="Trend range">
          {RANGES.map((days) => (
            <button
              key={days}
              type="button"
              className={trends.days === days ? 'active' : ''}
              onClick={() => onDaysChange(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>
      <div className="segmented compact" role="group" aria-label="Trend metric">
        <button type="button" className={metric === 'calories' ? 'active' : ''} onClick={() => setMetric('calories')}>Calories</button>
        <button type="button" className={metric === 'protein' ? 'active' : ''} onClick={() => setMetric('protein')}>Protein</button>
        <button type="button" className={metric === 'hydration' ? 'active' : ''} onClick={() => setMetric('hydration')}>Hydration</button>
      </div>
      <p className="muted trend-avg">{averageLabel(metric, average, units)}</p>
      <div
        className="trend-bars"
        style={{ gridTemplateColumns: `repeat(${trends.points.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`${metric} over ${trends.days} days`}
      >
        {trends.points.map((point, index) => (
          <div className="trend-col" key={point.date}>
            <div className="trend-bar-track">
              <i style={{ height: `${(values[index] / max) * 100}%` }} className={`fill-${metric}`} />
            </div>
            <span className={point.date === trends.endDate ? 'today-mark' : undefined}>{point.weekday}</span>
          </div>
        ))}
      </div>
      {weightEnabled && trends.weight.length > 0 && (
        <WeightTrend points={trends.weight} />
      )}
    </section>
  );
}

function WeightTrend({ points }: { points: TrendWeightPoint[] }) {
  const weights = points.map((point) => point.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = Math.max(max - min, 1);
  const unit = points[0]?.unit ?? 'lb';
  return (
    <div className="weight-trend">
      <h3>Weight check-ins</h3>
      <div className="weight-spark" aria-hidden="true">
        {points.map((point) => (
          <i
            key={point.date}
            style={{ height: `${((point.weight - min) / span) * 100}%` }}
            title={`${point.date}: ${point.weight} ${unit}`}
          />
        ))}
      </div>
      <p className="muted">Only you see this chart.</p>
    </div>
  );
}

function valueFor(point: TrendDay, metric: 'calories' | 'protein' | 'hydration'): number {
  if (metric === 'protein') return point.protein;
  if (metric === 'hydration') return point.hydrationMl;
  return point.calories;
}

function averageLabel(metric: 'calories' | 'protein' | 'hydration', average: number, units: Units): string {
  if (metric === 'calories') return `Daily average · ${Math.round(average)} kcal`;
  if (metric === 'protein') return `Daily average · ${Math.round(average)} g protein`;
  return `Daily average · ${formatVolume(average, units)}`;
}
