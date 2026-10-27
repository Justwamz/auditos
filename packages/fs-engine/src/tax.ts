export const MAX_TAXES = 5;

export interface TaxSpec {
  name: string;
  /** Rate in hundredths of a percent: 1600 is 16%. */
  rateBp: number;
  /** Charged on the net amount plus the taxes before it (for example VAT on top of excise duty). */
  onPrevious: boolean;
}

export interface TaxLine extends TaxSpec {
  amountCents: bigint;
}

export interface Totals {
  /** Amount before tax. */
  subtotalCents: bigint;
  taxes: TaxLine[];
  taxCents: bigint;
  totalCents: bigint;
}

export interface LineInput {
  /** Decimal with at most three places, for example "2.5" hours. */
  quantity: string;
  unitCents: bigint;
}

const QTY = /^(\d{1,9})(?:\.(\d{1,3}))?$/;

/** Integer division of non-negative numbers, rounding half up. */
const divRound = (a: bigint, b: bigint): bigint => (a * 2n + b) / (b * 2n);

/** Quantity (up to three decimals) times a unit price in cents, rounded half up to the cent. */
export function lineAmount(quantity: string, unitCents: bigint): bigint {
  const m = QTY.exec(quantity);
  if (!m) throw new RangeError('The quantity must be a number with at most three decimals');
  if (unitCents < 0n) throw new RangeError('A price cannot be negative');
  const milli = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
  return divRound(unitCents * milli, 1000n);
}

function validate(taxes: TaxSpec[]): void {
  if (taxes.length > MAX_TAXES) throw new RangeError(`At most ${MAX_TAXES} taxes can be applied to an invoice`);
  taxes.forEach((t, i) => {
    if (t.name.trim() === '') throw new RangeError('Every tax needs a name');
    if (!Number.isInteger(t.rateBp) || t.rateBp < 0 || t.rateBp > 10_000) throw new RangeError('A tax rate must be between 0% and 100%, with at most two decimals');
    if (i === 0 && t.onPrevious) throw new RangeError('The first tax has no previous tax to be charged on');
  });
}

function exclusiveTaxes(net: bigint, taxes: TaxSpec[]): TaxLine[] {
  const out: TaxLine[] = [];
  let soFar = 0n;
  for (const t of taxes) {
    const base = t.onPrevious ? net + soFar : net;
    const amountCents = divRound(base * BigInt(t.rateBp), 10_000n);
    out.push({ ...t, amountCents });
    soFar += amountCents;
  }
  return out;
}

/**
 * Totals for an invoice or quote. In "exclusive" mode the line prices are before tax and the taxes are added.
 * In "inclusive" mode the line prices already contain the taxes, which are worked back out. Either way the figures
 * add up exactly to the cent: in inclusive mode the total is always the sum of the line prices.
 */
export function computeTotals(lines: LineInput[], taxes: TaxSpec[], mode: 'exclusive' | 'inclusive'): Totals {
  if (lines.length === 0) throw new RangeError('At least one line is needed');
  validate(taxes);
  const sum = lines.reduce((n, l) => n + lineAmount(l.quantity, l.unitCents), 0n);
  if (sum <= 0n) throw new RangeError('The total must be above zero');

  if (mode === 'exclusive') {
    const lineTaxes = exclusiveTaxes(sum, taxes);
    const taxCents = lineTaxes.reduce((n, t) => n + t.amountCents, 0n);
    return { subtotalCents: sum, taxes: lineTaxes, taxCents, totalCents: sum + taxCents };
  }

  // Inclusive: gross = net x (1 + s), where s is the combined rate. Work s out as an exact fraction.
  let den = 1n;
  let sNum = 0n;
  for (const t of taxes) {
    const add = (t.onPrevious ? den + sNum : den) * BigInt(t.rateBp);
    sNum = sNum * 10_000n + add;
    den *= 10_000n;
  }
  let net = divRound(sum * den, den + sNum);
  let lineTaxes = exclusiveTaxes(net, taxes);
  const residual = sum - (net + lineTaxes.reduce((n, t) => n + t.amountCents, 0n));
  if (residual !== 0n) {
    const last = lineTaxes.length - 1;
    if (last >= 0 && lineTaxes[last]!.amountCents + residual >= 0n) lineTaxes = lineTaxes.map((t, i) => (i === last ? { ...t, amountCents: t.amountCents + residual } : t));
    else net += residual;
  }
  const taxCents = lineTaxes.reduce((n, t) => n + t.amountCents, 0n);
  return { subtotalCents: net, taxes: lineTaxes, taxCents, totalCents: net + taxCents };
}
