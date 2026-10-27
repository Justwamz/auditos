const DOT = '•';

/** Keeps the last `keep` characters that match `isKept`, hides the rest, and leaves spaces and symbols in place. */
function maskKeepingTail(value: string, keep: number, hideable: RegExp): string {
  const count = [...value].filter((c) => hideable.test(c)).length;
  if (count <= keep + 1) return [...value].map((c) => (hideable.test(c) ? DOT : c)).join('');
  let seen = 0;
  return [...value]
    .map((c) => {
      if (!hideable.test(c)) return c;
      seen += 1;
      return seen > count - keep ? c : DOT;
    })
    .join('');
}

export const maskPhone = (v: string): string => (v === '' ? '' : maskKeepingTail(v, 3, /\d/));
export const maskId = (v: string): string => (v === '' ? '' : maskKeepingTail(v, 3, /[A-Za-z0-9]/));
export const maskPin = (v: string): string => (v === '' ? '' : maskKeepingTail(v, 3, /[A-Za-z0-9]/));

/** First letter of the name and the whole domain. */
export function maskEmail(v: string): string {
  const at = v.lastIndexOf('@');
  if (at < 1) return v === '' ? '' : DOT.repeat(3);
  const local = v.slice(0, at);
  return `${local.length > 1 ? local[0] : ''}${DOT.repeat(3)}${v.slice(at)}`;
}
