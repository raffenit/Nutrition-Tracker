export type DateFormat = 'iso' | 'mdy' | 'mdy_long' | 'mdy_no_year' | 'dmy' | 'dmy_long' | 'dmy_no_year';

export const DEFAULT_DATE_FORMAT: DateFormat = 'mdy_long';

const FORMATS: DateFormat[] = ['iso', 'mdy', 'mdy_long', 'mdy_no_year', 'dmy', 'dmy_long', 'dmy_no_year'];

export function parseDateFormat(value: unknown): DateFormat {
  if (typeof value === 'string' && FORMATS.includes(value as DateFormat)) return value as DateFormat;
  return DEFAULT_DATE_FORMAT;
}
