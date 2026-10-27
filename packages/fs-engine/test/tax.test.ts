import { describe, expect, test } from 'vitest';
import { computeTotals, lineAmount, MAX_TAXES, type TaxSpec } from '../src';

const vat: TaxSpec = { name: 'VAT', rateBp: 1600, onPrevious: false };
const excise: TaxSpec = { name: 'Excise duty', rateBp: 1000, onPrevious: false };
const L = (quantity: string, unit: string) => ({ quantity, unitCents: BigInt(unit) });

describe('lineAmount', () => {
  test('quantity times unit price, in cents, rounded half up', () => {
    expect(lineAmount('1', 10000n)).toBe(10000n);
    expect(lineAmount('2.5', 10000n)).toBe(25000n);
    expect(lineAmount('0.333', 10000n)).toBe(3330n);
    expect(lineAmount('1.5', 333n)).toBe(500n);
    expect(lineAmount('0.001', 499n)).toBe(0n);
    expect(lineAmount('0.001', 500n)).toBe(1n);
  });
  test('rejects negative or malformed quantities', () => {
    for (const q of ['-1', 'abc', '1.2345', '', '1e3']) expect(() => lineAmount(q, 100n), q).toThrow(RangeError);
  });
  test('rejects a negative unit price', () => {
    expect(() => lineAmount('1', -1n)).toThrow(RangeError);
  });
});

describe('computeTotals, exclusive (prices are before tax)', () => {
  test('no tax: the total is the sum of the lines', () => {
    const t = computeTotals([L('1', '100000'), L('2', '25050')], [], 'exclusive');
    expect(t).toMatchObject({ subtotalCents: 150100n, taxCents: 0n, totalCents: 150100n, taxes: [] });
  });

  test('VAT 16% on KES 1,000.00', () => {
    const t = computeTotals([L('1', '100000')], [vat], 'exclusive');
    expect(t.subtotalCents).toBe(100000n);
    expect(t.taxes).toEqual([{ name: 'VAT', rateBp: 1600, onPrevious: false, amountCents: 16000n }]);
    expect(t.totalCents).toBe(116000n);
  });

  test('two taxes each on the net amount', () => {
    const t = computeTotals([L('1', '100000')], [vat, excise], 'exclusive');
    expect(t.taxes.map((x) => x.amountCents)).toEqual([16000n, 10000n]);
    expect(t.totalCents).toBe(126000n);
  });

  test('VAT charged on top of excise (on the previous tax)', () => {
    const t = computeTotals([L('1', '100000')], [excise, { ...vat, onPrevious: true }], 'exclusive');
    expect(t.taxes.map((x) => x.amountCents)).toEqual([10000n, 17600n]);
    expect(t.totalCents).toBe(127600n);
  });

  test('each tax is rounded to the cent', () => {
    const t = computeTotals([L('1', '333')], [vat], 'exclusive');
    expect(t.taxes[0]!.amountCents).toBe(53n);
    expect(t.totalCents).toBe(386n);
  });

  test('a zero-rate tax is allowed and adds nothing', () => {
    const t = computeTotals([L('1', '100000')], [{ name: 'Exempt', rateBp: 0, onPrevious: false }], 'exclusive');
    expect(t.totalCents).toBe(100000n);
  });
});

describe('computeTotals, inclusive (prices already contain the tax)', () => {
  test('VAT 16% inside KES 1,160.00 gives net 1,000.00', () => {
    const t = computeTotals([L('1', '116000')], [vat], 'inclusive');
    expect(t.subtotalCents).toBe(100000n);
    expect(t.taxes[0]!.amountCents).toBe(16000n);
    expect(t.totalCents).toBe(116000n);
  });

  test('VAT on top of excise inside one gross figure', () => {
    const t = computeTotals([L('1', '127600')], [excise, { ...vat, onPrevious: true }], 'inclusive');
    expect(t.subtotalCents).toBe(100000n);
    expect(t.taxes.map((x) => x.amountCents)).toEqual([10000n, 17600n]);
    expect(t.totalCents).toBe(127600n);
  });

  test('the total is always exactly the gross figure, whatever the rounding', () => {
    const cases: [string, TaxSpec[]][] = [
      ['1', [vat]],
      ['99999', [vat]],
      ['12345', [vat, excise]],
      ['77777', [excise, { ...vat, onPrevious: true }]],
      ['1', [vat, excise, { name: 'Levy', rateBp: 250, onPrevious: true }]],
      ['1000003', [{ name: 'Odd', rateBp: 777, onPrevious: false }, { name: 'Odder', rateBp: 1333, onPrevious: true }]],
    ];
    for (const [gross, taxes] of cases) {
      const t = computeTotals([L('1', gross)], taxes, 'inclusive');
      expect(t.totalCents, `${gross} ${taxes.map((x) => x.name)}`).toBe(BigInt(gross));
      expect(t.subtotalCents + t.taxCents).toBe(BigInt(gross));
      expect(t.taxes.reduce((n, x) => n + x.amountCents, 0n)).toBe(t.taxCents);
    }
  });

  test('exclusive and inclusive agree: taking the exclusive total as the inclusive gross returns the same net', () => {
    const ex = computeTotals([L('3', '45000')], [excise, { ...vat, onPrevious: true }], 'exclusive');
    const inc = computeTotals([L('1', ex.totalCents.toString())], [excise, { ...vat, onPrevious: true }], 'inclusive');
    expect(inc.subtotalCents).toBe(ex.subtotalCents);
    expect(inc.taxes.map((x) => x.amountCents)).toEqual(ex.taxes.map((x) => x.amountCents));
  });
});

describe('computeTotals, validation', () => {
  test('at most five taxes, rates between 0 and 100%, names present', () => {
    const many = Array.from({ length: MAX_TAXES + 1 }, (_, i) => ({ name: `T${i}`, rateBp: 100, onPrevious: false }));
    expect(() => computeTotals([L('1', '100')], many, 'exclusive')).toThrow(RangeError);
    expect(() => computeTotals([L('1', '100')], [{ name: 'Bad', rateBp: 10001, onPrevious: false }], 'exclusive')).toThrow(RangeError);
    expect(() => computeTotals([L('1', '100')], [{ name: 'Bad', rateBp: -1, onPrevious: false }], 'exclusive')).toThrow(RangeError);
    expect(() => computeTotals([L('1', '100')], [{ name: 'Bad', rateBp: 1.5, onPrevious: false }], 'exclusive')).toThrow(RangeError);
    expect(() => computeTotals([L('1', '100')], [{ name: '  ', rateBp: 100, onPrevious: false }], 'exclusive')).toThrow(RangeError);
  });

  test('an invoice needs at least one line and a positive total', () => {
    expect(() => computeTotals([], [], 'exclusive')).toThrow(RangeError);
    expect(() => computeTotals([L('1', '0')], [], 'exclusive')).toThrow(RangeError);
  });

  test('the first tax cannot be "on the previous tax"', () => {
    expect(() => computeTotals([L('1', '100')], [{ name: 'VAT', rateBp: 1600, onPrevious: true }], 'exclusive')).toThrow(RangeError);
  });
});
