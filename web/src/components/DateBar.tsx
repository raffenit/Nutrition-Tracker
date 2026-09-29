import { navigate, shiftDate } from '../nav';

type DateBarProps = { path: string; date: string; today: string };

export function DateBar({ path, date, today }: DateBarProps) {
  return (
    <div className="row datebar">
      <button type="button" onClick={() => navigate(`${path}?date=${shiftDate(date, -1)}`)}>Previous</button>
      <strong>{date}</strong>
      <button type="button" onClick={() => navigate(`${path}?date=${shiftDate(date, 1)}`)}>Next</button>
      {date !== today && <button type="button" onClick={() => navigate(path)}>Today</button>}
    </div>
  );
}
