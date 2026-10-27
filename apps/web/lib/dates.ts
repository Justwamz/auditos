/** Date helpers for screens that work in whole days in Nairobi time. Dates are YYYY-MM-DD strings, never time-zone dependent. */
export const TZ = 'Africa/Nairobi';

export const todayNairobi = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The Monday of the week containing the date. */
export const mondayOf = (date: string): string => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
};

export const dayLabel = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

export const monthEnd = (date: string): string => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** "1.5" or "1:30" as minutes; null when it is neither. */
export function parseHours(input: string): number | null {
  const t = input.trim();
  let minutes: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (/^\d{1,2}(\.\d{1,2})?$/.test(t)) minutes = Math.round(Number(t) * 60);
  else return null;
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

export const hoursLabel = (minutes: number): string => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

/** KES with thousands separators, from a decimal string such as "1500.00". */
export const kes = (v: string | null | undefined): string => (v === null || v === undefined ? '' : `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
