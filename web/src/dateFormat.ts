export type DateFormat = 'iso' | 'mdy' | 'mdy_long' | 'dmy' | 'dmy_long';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DATE_FORMAT_OPTIONS: Array<{ value: DateFormat; label: string; example: string }> = [
  { value: 'mdy_long', label: 'Weekday, month day, year', example: 'Mon, Sep 29, 2026' },
  { value: 'mdy', label: 'Month / day / year', example: '9/29/2026' },
  { value: 'dmy_long', label: 'Weekday, day month year', example: 'Mon, 29 Sep 2026' },
  { value: 'dmy', label: 'Day / month / year', example: '29/9/2026' },
  { value: 'iso', label: 'Year-month-day', example: '2026-09-29' },
];

export function formatDisplayDate(iso: string, format: DateFormat): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  switch (format) {
    case 'iso':
      return iso;
    case 'mdy':
      return `${month}/${day}/${year}`;
    case 'dmy':
      return `${day}/${month}/${year}`;
    case 'dmy_long':
      return `${weekday}, ${day} ${MONTHS[month - 1]} ${year}`;
    case 'mdy_long':
    default:
      return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year}`;
  }
}
