import { deflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { buildStatements, mapTrialBalance, type Statements } from '@auditos/fs-engine';
import { trading } from '../../fs-engine/test/fixtures';
import { exportDocx, exportPdf, exportXlsx, type ExportMeta } from '../src';

const built = buildStatements(mapTrialBalance(trading.tb, trading.mapping), { periodStart: '2026-01-01', periodEnd: '2026-12-31', framework: 'IFRS_SME' });
if (!built.ok) throw new Error('fixture blocked');
const statements: Statements = built.statements;

const meta = (over: Partial<ExportMeta> = {}): ExportMeta => ({
  entityName: 'Acme Traders Ltd',
  periodEnd: '2026-12-31',
  draft: true,
  exportedBy: 'partner@firm-a.example.test',
  exportedAt: '2026-10-26T10:00:00Z',
  trialBalance: trading.tb,
  ...over,
});

const crc = (b: Buffer): number => {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
};
const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
const goodPng = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
};
type Lh = NonNullable<ExportMeta['letterhead']>;
const brand = (over: Partial<Lh> = {}): Lh => ({
  name: 'Waweru & Associates', address: 'Nairobi', phone: '+254 700 123 456', email: 'hello@waweru.example.test', website: 'https://waweru.example.test',
  kraPin: 'P051234567Q', bankDetails: 'Bank X', footerNote: 'Payable within 30 days.', primary: '#1d4ed8', logo: null, ...over,
});
const CONTACT = 'Tel: +254 700 123 456 | Email: hello@waweru.example.test | Web: https://waweru.example.test';
const pdfText = (buf: Buffer) => {
  const raw = buf.toString('latin1');
  const out: string[] = [];
  const hex = (h: string) => Buffer.from(h, 'hex').toString('latin1');
  for (const m of raw.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hex(x[1]!)).join(''));
    else out.push(hex(m[2]!));
  }
  return out.join('\n');
};
const docxParts = async (buf: Buffer, kind: 'header' | 'footer') => {
  const part = kind === 'header' ? /word\/header\d*\.xml$/ : /word\/footer\d*\.xml$/;
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const xml = (await Promise.all(names.filter((n) => part.test(n)).map((n) => zip.files[n]!.async('string')))).join('');
  return { xml, hasMedia: names.some((n) => /word\/media\//.test(n)) };
};

describe('branded statements: PDF', () => {
  test('firm name, contact line, footer note and Powered by AuditOS; the logo is embedded', async () => {
    const buf = await exportPdf(statements, meta({ draft: false, letterhead: brand({ logo: { bytes: goodPng(), type: 'image/png' } }) }));
    const t = pdfText(buf);
    for (const s of ['Waweru & Associates', CONTACT, 'Payable within 30 days.', 'Powered by AuditOS', 'Acme Traders Ltd']) expect(t, s).toContain(s);
    expect(buf.toString('latin1')).toContain('/Subtype /Image');
  });
  test('Powered by AuditOS is on every page', async () => {
    const long: Statements = { ...statements, notes: [{ id: 'many', title: 'Many rows', rows: Array.from({ length: 170 }, (_, i) => ({ id: `r${i}`, label: `Line ${i}`, current: 100n })) }] };
    const buf = await exportPdf(long, meta({ draft: false, letterhead: brand() }));
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
    expect(pdfText(buf).split('Powered by AuditOS').length - 1).toBe(pages);
  });
  test('a damaged logo, or bytes that are not a picture, fall back to the name and still finish', async () => {
    const damaged = Buffer.concat([goodPng().subarray(0, 40), Buffer.from('garbage')]);
    for (const logo of [{ bytes: damaged, type: 'image/png' as const }, { bytes: Buffer.from('not an image'), type: 'image/jpeg' as const }]) {
      const buf = await exportPdf(statements, meta({ draft: false, letterhead: brand({ logo }) }));
      expect(buf.toString('latin1')).not.toContain('/Subtype /Image');
      expect(pdfText(buf)).toContain('Waweru & Associates');
    }
  });
  test('without a letterhead there is no Powered by line, and with one every line of the plain statement is still there in order', async () => {
    const plain = pdfText(await exportPdf(statements, meta({ draft: false })));
    expect(plain).not.toContain('Powered by AuditOS');
    const withLh = pdfText(await exportPdf(statements, meta({ draft: false, letterhead: brand() })));
    let from = 0;
    for (const line of plain.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('Exported by'))) {
      const at = withLh.indexOf(line, from);
      expect(at, line).toBeGreaterThanOrEqual(0);
      from = at;
    }
  });
  test('control characters and a very long footer note cannot break the page', async () => {
    const buf = await exportPdf(statements, meta({ letterhead: brand({ name: 'Evil\u0000 Firm\u0007', footerNote: 'x'.repeat(290) }) }));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfText(buf)).toContain('Powered by AuditOS');
  });
});

describe('branded statements: Word', () => {
  test('the header holds the name, contact line and logo; the footer holds the note and Powered by AuditOS', async () => {
    const buf = await exportDocx(statements, meta({ draft: false, letterhead: brand({ logo: { bytes: goodPng(), type: 'image/png' } }) }));
    const h = await docxParts(buf, 'header');
    const f = await docxParts(buf, 'footer');
    expect(h.xml).toContain('Waweru &amp; Associates');
    expect(h.xml).toContain('Tel: +254 700 123 456');
    expect(h.xml).toContain('hello@waweru.example.test');
    expect(f.xml).toContain('Powered by AuditOS');
    expect(f.xml).toContain('Payable within 30 days.');
    expect(f.xml).toContain('partner@firm-a.example.test');
    expect(h.hasMedia).toBe(true);
  });
  test('a draft still shows DRAFT, and a bad logo is simply left out', async () => {
    const h = await docxParts(await exportDocx(statements, meta({ draft: true, letterhead: brand({ logo: { bytes: Buffer.from('nope'), type: 'image/png' } }) })), 'header');
    expect(h.xml).toContain('DRAFT');
    expect(h.xml).toContain('Waweru &amp; Associates');
    expect(h.hasMedia).toBe(false);
  });
  test('without a letterhead there is no Powered by line', async () => {
    const f = await docxParts(await exportDocx(statements, meta()), 'footer');
    expect(f.xml).not.toContain('Powered by AuditOS');
  });
});

describe('branded statements: Excel', () => {
  const load = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  };
  const grid = (ws: ExcelJS.Worksheet) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (r) => rows.push([1, 2, 3, 4, 5].map((c) => String(r.getCell(c).value ?? ''))));
    return rows;
  };
  test('name and contact line on the first row, footer on the last, everything else unchanged and shifted', async () => {
    const plain = await load(await exportXlsx(statements, meta({ draft: false })));
    const branded = await load(await exportXlsx(statements, meta({ draft: false, letterhead: brand() })));
    for (const ws of plain.worksheets) {
      const a = grid(ws);
      const b = grid(branded.getWorksheet(ws.name)!);
      if (ws.name === 'Trial balance') {
        expect(b).toEqual(a);
        continue;
      }
      expect(b[0]![0]).toBe(`Waweru & Associates | ${CONTACT} | KRA PIN: P051234567Q`);
      expect(b.slice(1, a.length)).toEqual(a.slice(0, -1));
      const last = b[b.length - 1]![0];
      expect(last).toContain('Powered by AuditOS');
      expect(last).toContain('Payable within 30 days.');
    }
  });
  test('a name or note that looks like a formula is written as text', async () => {
    const wb = await load(await exportXlsx(statements, meta({ letterhead: brand({ name: '=HYPERLINK("http://evil")', footerNote: '@SUM(1)' }) })));
    const ws = wb.getWorksheet('Financial position')!;
    expect(String(ws.getCell('A1').value).startsWith("'")).toBe(true);
    ws.eachRow((row) => row.eachCell((c) => expect(typeof c.value === 'object' && c.value !== null && 'formula' in c.value).toBe(false)));
  });
});
