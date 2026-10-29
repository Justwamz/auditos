import { deflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { exportBillingPdf, type BillingPdf } from '../src/billing-pdf';

const base: BillingPdf = {
  kind: 'invoice', number: 'KA-2026-0001', status: 'sent',
  letterhead: { name: 'Kangethe & Associates', address: 'Nairobi', phone: '+254 700 111 222', email: 'info@kangethe.example.test', website: 'https://kangethe.example.test', kraPin: 'P051234567Q', bankDetails: 'Bank X, account 123', footerNote: 'Thank you for your business', primary: '#1f5f4a', logo: null },
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

  test('a quote has its own wording and shows the payment details too', async () => {
    const t = await text({ ...base, kind: 'quote', number: 'KQ-2026-0001', dueOrValidUntil: '2026-12-10' });
    expect(t).toContain('QUOTATION KQ-2026-0001');
    expect(t).toContain('Valid until: 2026-12-10');
    expect(t).toContain('Payment details');
    expect(t).toContain('Bank X, account 123');
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

/** A real 2x2 PNG, so the image is embedded as an image object. */
const tinyPng = (): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const hasImage = (b: Buffer) => /\/Subtype \/Image/.test(b.toString('latin1'));

describe('letterhead on the page', () => {
  test('shows the name, address, phone, email, website, KRA PIN and the footer, and always Powered by AuditOS', async () => {
    const t = await text(base);
    for (const s of ['Kangethe & Associates', 'Nairobi', '+254 700 111 222', 'info@kangethe.example.test', 'https://kangethe.example.test', 'P051234567Q', 'Thank you for your business', 'Powered by AuditOS']) expect(t, s).toContain(s);
  });

  test('a blank line is left out without a trace', async () => {
    const t = await text({ ...base, letterhead: { ...base.letterhead, phone: null, website: '  ', footerNote: null } });
    expect(t).not.toContain('Tel:');
    expect(t).not.toContain('Web:');
    expect(t).toContain('Email: info@kangethe.example.test');
  });

  test('every page of a long document carries Powered by AuditOS and the footer note', async () => {
    const lines = Array.from({ length: 90 }, (_, i) => ({ description: `Line ${i + 1}`, quantity: '1', unit: '100.00', amount: '100.00' }));
    const buf = await exportBillingPdf({ ...base, lines });
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
    expect(pdfText(buf).split('Powered by AuditOS').length - 1).toBe(pages);
    expect(pdfText(buf).split('Thank you for your business').length - 1).toBe(pages);
  });

  test('a logo is embedded as an image', async () => {
    const buf = await exportBillingPdf({ ...base, letterhead: { ...base.letterhead, logo: { bytes: tinyPng(), type: 'image/png' } } });
    expect(hasImage(buf)).toBe(true);
    expect(pdfText(buf)).toContain('Kangethe & Associates');
  });

  test('without a logo there is no image, and the name stands in', async () => {
    const buf = await exportBillingPdf(base);
    expect(hasImage(buf)).toBe(false);
    expect(pdfText(buf)).toContain('Kangethe & Associates');
  });

  test('logo bytes that are not an image do not stop the document', async () => {
    for (const bytes of [Buffer.from('not an image at all'), Buffer.alloc(0), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('garbage garbage')])]) {
      const buf = await exportBillingPdf({ ...base, letterhead: { ...base.letterhead, logo: { bytes, type: 'image/png' } } });
      expect(buf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdfText(buf)).toContain('Powered by AuditOS');
    }
  });

  test('markup characters in the details are printed as plain text', async () => {
    const t = await text({ ...base, letterhead: { ...base.letterhead, footerNote: '<b>Bold</b> & "quoted"', name: '<i>Firm</i> (Pty)' } });
    expect(t).toContain('<b>Bold</b> & "quoted"');
    expect(t).toContain('<i>Firm</i> (Pty)');
  });
});
