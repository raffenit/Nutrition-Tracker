import type { DateFormat } from '../dateFormat';
import { formatDisplayDate } from '../dateFormat';
import { navigate, shiftDate } from '../nav';

type DateBarProps = { path: string; date: string; today: string; dateFormat: DateFormat };

export function DateBar({ path, date, today, dateFormat }: DateBarProps) {
  const label = formatDisplayDate(date, dateFormat);
  const isToday = date === today;
  return (
    <header className="datebar">
      <div className="datebar-nav" role="group" aria-label="Choose day">
        <button type="button" className="datebar-arrow" aria-label="Previous day" onClick={() => navigate(`${path}?date=${shiftDate(date, -1)}`)}>
          ‹
        </button>
        <div className="datebar-center">
          <time className="datebar-label" dateTime={date}>{label}</time>
          {isToday && <span className="datebar-badge">Today</span>}
        </div>
        <button type="button" className="datebar-arrow" aria-label="Next day" onClick={() => navigate(`${path}?date=${shiftDate(date, 1)}`)}>
          ›
        </button>
      </div>
      <div className="datebar-footer">
        {isToday ? (
          <span className="datebar-jump datebar-jump-spacer" aria-hidden="true">
            Jump to today
          </span>
        ) : (
          <button type="button" className="datebar-jump" onClick={() => navigate(path)}>
            Jump to today
          </button>
        )}
      </div>
    </header>
  );
}
