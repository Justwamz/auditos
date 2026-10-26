export type Money = bigint;

const MONEY_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function parseMoney(s: string): Money {
  const m = MONEY_RE.exec(s.trim());
  if (!m) throw new Error(`Invalid money value: ${JSON.stringify(s)}`);
  const [, sign, whole, frac = ''] = m;
  const cents = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

export function formatMoney(v: Money): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}
