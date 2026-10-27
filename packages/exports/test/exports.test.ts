import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { buildStatements, mapTrialBalance, type Statements } from '@auditos/fs-engine';
import { trading } from '../../fs-engine/test/fixtures';
import { exportDocx, exportPdf, exportXlsx, fmt, type ExportMeta } from '../src';

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

describe('fmt', () => {
  test('groups thousands, keeps two decimals and brackets negatives', () => {
    expect(fmt(123456789n)).toBe('1,234,567.89');
    expect(fmt(-500n)).toBe('(5.00)');
    expect(fmt(0n)).toBe('0.00');
  });
});

describe('docx', () => {
  const text = async (buf: Buffer) => {
    const zip = await JSZip.loadAsync(buf);
    const parts = await Promise.all(Object.keys(zip.files).filter((n) => /word\/(document|header\d*|footer\d*)\.xml$/.test(n)).map((n) => zip.files[n]!.async('string')));
    return parts.join('\n');
  };
  test('is a non-empty docx containing the statements, entity and exporter', async () => {
    const buf = await exportDocx(statements, meta());
    expect(buf.length).toBeGreaterThan(2000);
    const xml = await text(buf);
    expect(xml).toContain('Acme Traders Ltd');
    expect(xml).toContain('Statement of financial position');
    expect(xml).toContain('Profit for the year');
    expect(xml).toContain('partner@firm-a.example.test');
  });
  test('is marked DRAFT until approved', async () => {
    expect(await text(await exportDocx(statements, meta({ draft: true })))).toContain('DRAFT');
    expect(await text(await exportDocx(statements, meta({ draft: false })))).not.toContain('DRAFT');
  });
});

describe('xlsx', () => {
  const load = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  };
  test('has statement sheets and a trial balance sheet', async () => {
    const wb = await load(await exportXlsx(statements, meta()));
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(['Financial position', 'Profit or loss', 'Changes in equity', 'Trial balance']));
    expect(String(wb.getWorksheet('Financial position')!.getCell('A1').value)).toContain('DRAFT');
  });
  test('is not marked DRAFT once approved', async () => {
    const wb = await load(await exportXlsx(statements, meta({ draft: false })));
    expect(String(wb.getWorksheet('Financial position')!.getCell('A1').value)).not.toContain('DRAFT');
  });
  test('escapes formula-looking account names so Excel cannot evaluate them', async () => {
    const evil = [...trading.tb, { code: '9', name: "=HYPERLINK(\"http://evil\",\"x\")", debit: 0n, credit: 0n }, { code: '10', name: '@SUM(1+1)', debit: 0n, credit: 0n }, { code: '11', name: '-2+3', debit: 0n, credit: 0n }, { code: '12', name: '+cmd', debit: 0n, credit: 0n }];
    const wb = await load(await exportXlsx(statements, meta({ trialBalance: evil })));
    const sheet = wb.getWorksheet('Trial balance')!;
    const names: string[] = [];
    sheet.eachRow((row) => names.push(String(row.getCell(2).value)));
    for (const n of names.filter((v) => /HYPERLINK|SUM|2\+3|cmd/.test(v))) expect(n.startsWith("'")).toBe(true);
    sheet.eachRow((row) => row.eachCell((c) => expect(typeof c.value === 'object' && c.value !== null && 'formula' in c.value).toBe(false)));
  });
});

describe('pdf', () => {
  test('is a pdf and marked DRAFT only before approval', async () => {
    const draft = await exportPdf(statements, meta({ draft: true }));
    const final = await exportPdf(statements, meta({ draft: false }));
    expect(draft.subarray(0, 4).toString()).toBe('%PDF');
    expect(draft.length).toBeGreaterThan(1500);
    expect(draft.toString('latin1')).toContain('DRAFT');
    expect(final.toString('latin1')).not.toContain('DRAFT');
  });
});

describe('pdf pagination', () => {
  test('a long statement flows across a sensible number of pages instead of one page per row', async () => {
    const long: Statements = {
      ...statements,
      notes: [{ id: 'many', title: 'Many rows', rows: Array.from({ length: 170 }, (_, i) => ({ id: `r${i}`, label: `Account line ${i}`, current: BigInt(i) * 100n })) }],
    };
    const pdf = await exportPdf(long, meta({ draft: false }));
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pages).toBeLessThan(12);
  });

  test('content never starts in the footer band after a page break', async () => {
    const long: Statements = {
      ...statements,
      notes: [{ id: 'many', title: 'Many rows', rows: Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, label: `Line ${i}`, current: 100n })) }],
    };
    const text = (await exportPdf(long, meta({ draft: false }))).toString('latin1');
    // Text positions are written as "1 0 0 1 x y Tm"; the footer sits at y = 792 - 800 mirrored. No body row may share its y.
    const ys = [...text.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].map((m) => Number(m[1]));
    const footerLike = ys.filter((y) => Math.abs(y - (842 - 800 - 8)) < 4).length;
    expect(footerLike).toBeLessThanOrEqual(Math.ceil(ys.length / 40) + 1);
  });
});
