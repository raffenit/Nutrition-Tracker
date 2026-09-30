export type DateFormat = 'iso' | 'mdy' | 'mdy_long' | 'dmy' | 'dmy_long';

export const DEFAULT_DATE_FORMAT: DateFormat = 'mdy_long';

export function parseDateFormat(value: unknown): DateFormat {
  if (value === 'iso' || value === 'mdy' || value === 'mdy_long' || value === 'dmy' || value === 'dmy_long') {
    return value;
  }
  return DEFAULT_DATE_FORMAT;
}
