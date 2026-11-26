import type { DateFormat } from '../dateFormat';
import { formatDisplayDate } from '../dateFormat';
import { navigate, shiftDate } from '../nav';

type DateBarProps = { path: string; date: string; today: string; dateFormat: DateFormat; query?: string };

export function DateBar({ path, date, today, dateFormat, query }: DateBarProps) {
  const label = formatDisplayDate(date, dateFormat, today);
  const isToday = date === today;
  const base = query ? `${path}?${query}` : path;
  return (
    <header className="datebar">
      <div className="datebar-nav" role="group" aria-label="Choose day">
        <button type="button" className="datebar-arrow" aria-label="Previous day" onClick={() => navigate(`${base}${query ? '&' : '?'}date=${shiftDate(date, -1)}`)}>
          ‹
        </button>
        <div className="datebar-center">
          <time className="datebar-label" dateTime={date}>{label}</time>
          {isToday ? (
            <span className="datebar-badge">Today</span>
          ) : (
            <button type="button" className="datebar-jump-link" onClick={() => navigate(base)}>
              Jump to today
            </button>
          )}
        </div>
        <button type="button" className="datebar-arrow" aria-label="Next day" onClick={() => navigate(`${base}${query ? '&' : '?'}date=${shiftDate(date, 1)}`)}>
          ›
        </button>
      </div>
    </header>
  );
}
