const CURRENCY = /^(?:kes|ksh[s]?\.?|sh\.?|usd|\$)\s*/i;
const PLAIN = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{1,2})?$/;

export interface Amount {
  /** Negative when the text said so (brackets or a minus sign). */
  cents: bigint;
  /** A Dr or Cr marker written after the figure, if any. */
  side: 'dr' | 'cr' | null;
}

/** An amount as printed on a statement. Anything that is not clearly one amount returns null; digits are never rounded. */
export function parseAmount(text: string): Amount | null {
  let t = text.trim().replace(/−/g, '-');
  if (t === '') return null;
  let side: Amount['side'] = null;
  const marker = /\s*(dr|cr)\.?$/i.exec(t);
  if (marker) {
    side = marker[1]!.toLowerCase() as 'dr' | 'cr';
    t = t.slice(0, marker.index).trim();
  }
  t = t.replace(CURRENCY, '').trim();
  let negative = false;
  if (t.startsWith('(') && t.endsWith(')')) {
    negative = true;
    t = t.slice(1, -1).trim();
  } else if (t.startsWith('-')) {
    negative = true;
    t = t.slice(1).trim();
  } else if (t.endsWith('-')) {
    negative = true;
    t = t.slice(0, -1).trim();
  }
  if (t === '' || t === '.' || !PLAIN.test(t)) return null;
  const [whole = '', frac = ''] = t.replace(/,/g, '').split('.');
  const cents = BigInt(whole === '' ? '0' : whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return { cents: negative ? -cents : cents, side };
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const fullYear = (s: string): number => (s.length === 4 ? Number(s) : Number(s) < 70 ? 2000 + Number(s) : 1900 + Number(s));

/** A date as printed on a statement, as YYYY-MM-DD. Day first unless told otherwise; impossible dates return null. */
export function parseDate(text: string, order: 'dmy' | 'mdy' = 'dmy'): string | null {
  const t = text.trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i, '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return order === 'dmy' ? valid(fullYear(m[3]!), b, a) : valid(fullYear(m[3]!), a, b);
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ ,-]+(\d{4}|\d{2})$/.exec(t);
  if (m && MONTHS[m[2]!.toLowerCase()]) return valid(fullYear(m[3]!), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]));
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1]!.toLowerCase()]) return valid(Number(m[3]), MONTHS[m[1]!.toLowerCase()]!, Number(m[2]));
  return null;
}
