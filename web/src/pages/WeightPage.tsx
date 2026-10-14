import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { navigate } from '../nav';
import type { WeightStatus } from '../types';

const RANGES = [30, 90] as const;

export function WeightPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const [weight, setWeight] = useState<WeightStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(span = days): Promise<void> {
    const result = await api<{ weight: WeightStatus }>(`/api/weight?historyDays=${span}`);
    setWeight(result.weight);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load weight history'));
  }, [days]);

  if (!weight) return <p>{error ?? 'Loading weight…'}</p>;
  if (!weight.enabled) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={() => navigate('/')}>← Today</button>
        <section className="card">
          <h1>Weight history</h1>
          <p className="muted">Weekly check-ins are off. Turn them on in Settings to track weight over time.</p>
          <button type="button" onClick={() => navigate('/settings')}>Open settings</button>
        </section>
      </div>
    );
  }

  const entries = [...weight.entries].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const weights = entries.map((entry) => entry.weight);
  const min = weights.length ? Math.min(...weights) : 0;
  const max = weights.length ? Math.max(...weights) : 1;
  const span = Math.max(max - min, 1);

  return (
    <div className="page">
      <button type="button" className="back-link" onClick={() => navigate('/')}>← Today</button>
      <section className="card">
        <div className="row weight-page-head">
          <h1>Weight history</h1>
          <div className="segmented compact" role="group" aria-label="History range">
            {RANGES.map((range) => (
              <button key={range} type="button" className={days === range ? 'active' : ''} onClick={() => setDays(range)}>
                {range}d
              </button>
            ))}
          </div>
        </div>
        <p className="muted">Only you see this. It never appears on the family board.</p>
        {entries.length > 0 && (
          <div className="weight-trend weight-trend-large">
            <div className="weight-spark weight-spark-large" aria-hidden="true">
              {entries.map((entry) => (
                <i
                  key={entry.id}
                  style={{ height: `${((entry.weight - min) / span) * 100}%` }}
                  title={`${entry.localDate}: ${entry.weight} ${entry.unit}`}
                />
              ))}
            </div>
          </div>
        )}
        {entries.length === 0 && <p className="muted">No check-ins in this range yet.</p>}
        <ul className="list weight-history-list">
          {[...entries].reverse().map((entry) => (
            <li key={entry.id}>
              <span><strong>{entry.localDate}</strong> · {entry.weight} {entry.unit}</span>
              <button
                type="button"
                className="danger"
                onClick={() => void api<{ weight: WeightStatus }>(`/api/weight/${entry.id}?historyDays=${days}`, { method: 'DELETE' }).then((result) => setWeight(result.weight)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not delete'))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="notice">{error}</p>}
      </section>
    </div>
  );
}
