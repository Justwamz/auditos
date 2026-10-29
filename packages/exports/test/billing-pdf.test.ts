import { describe, expect, test } from 'vitest';
import { exportBillingPdf, type BillingPdf } from '../src/billing-pdf';

const base: BillingPdf = {
  kind: 'invoice', number: 'KA-2026-0001', status: 'sent',
  issuer: { legalName: 'Kangethe & Associates', address: 'Nairobi', kraPin: 'P051234567Q', bankDetails: 'Bank X, account 123' },
  clientName: 'Mwangaza Traders Ltd', date: '2026-11-10', dueOrValidUntil: '2026-11-24',
  lines: [{ description: 'Professional time: Brian Kiptoo', quantity: '3.50', unit: '1,500.00', amount: '5,250.00' }],
  subtotal: '5,250.00', taxMode: 'exclusive', taxes: [{ name: 'VAT', rate: '16.00', amount: '840.00' }], total: '6,090.00', notes: null,
};
/** The text drawn on the pages. pdfkit writes it as hex strings, split by kerning, so each text-showing operation is joined back up. */
export function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const hex = (h: string) => Buffer.from(h, 'hex').toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hex(x[1]!)).join(''));
    else out.push(hex(m[2]!));
  }
  return out.join('\n');
}
const text = async (d: BillingPdf) => {
  const buf = await exportBillingPdf(d);
  const title = /\/Title \(([^)]*)\)/.exec(buf.toString('latin1'))?.[1] ?? '';
  return `${title}\n${pdfText(buf)}`;
};

describe('invoice and quote PDFs', () => {
  test('is a PDF that shows the number, the client, the lines and the totals', async () => {
    expect((await exportBillingPdf(base)).subarray(0, 4).toString()).toBe('%PDF');
    const t = await text(base);
    for (const s of ['INVOICE KA-2026-0001', 'Mwangaza Traders Ltd', 'Professional time: Brian Kiptoo', '5,250.00', 'VAT 16.00%', '6,090.00', 'P051234567Q']) expect(t, s).toContain(s);
  });

  test('a draft is watermarked and has no number', async () => {
    const t = await text({ ...base, number: null, status: 'draft' });
    expect(t).toContain('DRAFT INVOICE');
    expect(t).toContain('DRAFT');
  });

  test('a void invoice says VOID', async () => {
    expect(await text({ ...base, status: 'void' })).toContain('VOID');
  });

  test('a simulated tax submission is stated on the document, with the made-up control number', async () => {
    const t = await text({ ...base, simulatedTax: { controlNumber: 'SIM-ABCDEF1234', message: 'PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice.' } });
    expect(t).toContain('PRACTICE ONLY: not sent to KRA. Not a valid tax invoice.');
    expect(t).toContain('SIM-ABCDEF1234');
    expect(t).toContain('has not been sent to KRA');
  });

  test('an invoice saved with the old wording still prints the fixed practice sentence', async () => {
    const t = await text({ ...base, simulatedTax: { controlNumber: 'SIM-OLD0000001', message: 'Simulation: nothing was sent to KRA. This is not a valid tax invoice.' } });
    expect(t).not.toMatch(/simulat/i);
    expect(t).toContain('PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice.');
  });

  test('a document without tax says none was charged; an inclusive one says the tax is included', async () => {
    expect(await text({ ...base, taxes: [], total: '5,250.00' })).toContain('None charged');
    expect(await text({ ...base, taxMode: 'inclusive' })).toContain('(included)');
  });

  test('a quote has its own wording and no payment details', async () => {
    const t = await text({ ...base, kind: 'quote', number: 'KQ-2026-0001', dueOrValidUntil: '2026-12-10' });
    expect(t).toContain('QUOTATION KQ-2026-0001');
    expect(t).toContain('Valid until: 2026-12-10');
    expect(t).not.toContain('Payment details');
  });

  test('payments and balance appear when given', async () => {
    const t = await text({ ...base, paid: '2,000.00', outstanding: '4,090.00' });
    expect(t).toContain('Balance due');
    expect(t).toContain('4,090.00');
  });

  test('a long invoice runs onto more pages without losing lines', async () => {
    const lines = Array.from({ length: 90 }, (_, i) => ({ description: `Expense line number ${i + 1}`, quantity: '1', unit: '100.00', amount: '100.00' }));
    const buf = await exportBillingPdf({ ...base, lines });
    const t = pdfText(buf);
    expect(t).toContain('Expense line number 1');
    expect(t).toContain('Expense line number 90');
    expect((buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBeGreaterThan(1);
  });
});
