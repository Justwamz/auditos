import ExcelJS from 'exceljs';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { consultancy, trading } from '../../../packages/fs-engine/test/fixtures';
import { csvOf, harness, importTb, login, makeTenant, makeUser, multipartBody, ownerQuery, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser, A: TestUser;
let sP: Session, sM: Session, sF: Session, sA: Session;
let client: string;
let fullIfrsClient: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const newEngagement = async (c = client, start = '2026-01-01', end = '2026-12-31'): Promise<string> => {
  const e = await call(sM, 'POST', '/engagements', { clientId: c, periodStart: start, periodEnd: end, partnerId: P.id });
  expect(e.statusCode).toBe(201);
  const id = e.json().id as string;
  expect((await call(sM, 'POST', `/engagements/${id}/members`, { userId: F.id })).statusCode).toBe(201);
  return id;
};

const withTrading = async (e: string) => {
  expect((await importTb(h, sF, e, 'tb.csv', Buffer.from(csvOf(trading.tb)))).statusCode).toBe(200);
  expect((await call(sF, 'PUT', `/engagements/${e}/mapping`, { mapping: trading.mapping })).statusCode).toBe(200);
};

const statements = async (e: string, s = sF) => (await call(s, 'GET', `/engagements/${e}/statements`)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'financials');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  A = await makeUser(h, T.id, 'firm_admin', 0);
  sA = await login(h, A);
  sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  client = (await call(sM, 'POST', '/clients', { name: 'Fin Client Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  fullIfrsClient = (await call(sM, 'POST', '/clients', { name: 'Full IFRS Client', sector: 'trading', legalForm: 'limited_company', framework: 'FULL_IFRS', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('trial balance import', () => {
  test('rejects a non-numeric amount and names the row', async () => {
    const e = await newEngagement();
    const csv = 'code,name,debit,credit\n1000,Cash,100.00,0\n1100,Debtors,abc,0\n1200,Stock,5.001,0';
    const res = await importTb(h, sF, e, 'bad.csv', Buffer.from(csv));
    expect(res.statusCode).toBe(422);
    const rows = res.json().rows as { row: number; message: string }[];
    expect(rows.map((r) => r.row)).toEqual([3, 4]);
  });

  test('rejects missing columns, duplicate codes, negative amounts and too many rows', async () => {
    const e = await newEngagement();
    expect((await importTb(h, sF, e, 'x.csv', Buffer.from('a,b\n1,2'))).statusCode).toBe(422);
    expect((await importTb(h, sF, e, 'x.csv', Buffer.from('code,name,debit,credit\n1,A,1,0\n1,B,0,1'))).json().rows[0].message).toMatch(/duplicate/i);
    expect((await importTb(h, sF, e, 'x.csv', Buffer.from('code,name,debit,credit\n1,A,-1,0'))).statusCode).toBe(422);
    const big = ['code,name,debit,credit', ...Array.from({ length: 5001 }, (_, i) => `${i},N${i},0,0`)].join('\n');
    expect((await importTb(h, sF, e, 'big.csv', Buffer.from(big))).statusCode).toBe(422);
  });

  test('accepts quoted commas, a UTF-8 BOM and CRLF line endings', async () => {
    const e = await newEngagement();
    const csv = '﻿Code,Name,Debit,Credit\r\n1000,"Cash, at bank",100.50,0\r\n3000,Capital,0,100.50\r\n';
    expect((await importTb(h, sF, e, 'ok.csv', Buffer.from(csv))).statusCode).toBe(200);
    const tb = (await call(sF, 'GET', `/engagements/${e}/tb`)).json();
    expect(tb.lines[0]).toMatchObject({ code: '1000', name: 'Cash, at bank', debit: '100.50' });
  });

  test('formula-looking names are stored as inert text and escaped in exports', async () => {
    const e = await newEngagement();
    const csv = `code,name,debit,credit\n1,"=cmd|' /C calc'!A0",10.00,0\n2,Capital,0,10.00`;
    expect((await importTb(h, sF, e, 'inj.csv', Buffer.from(csv))).statusCode).toBe(200);
    await call(sF, 'PUT', `/engagements/${e}/mapping`, { mapping: { '1': 'cash', '2': 'share_capital' } });
    await stepUp(h, sF, F);
    const res = await call(sF, 'POST', `/engagements/${e}/export`, { format: 'xlsx' });
    expect(res.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const name = String(wb.getWorksheet('Trial balance')!.getRow(2).getCell(2).value);
    expect(name.startsWith("'=cmd")).toBe(true);
  });

  test('imports an xlsx file and rejects one that contains formulas', async () => {
    const e = await newEngagement();
    const good = new ExcelJS.Workbook();
    const ws = good.addWorksheet('TB');
    ws.addRow(['Code', 'Name', 'Debit', 'Credit']);
    ws.addRow(['1000', 'Cash', 250.5, 0]);
    ws.addRow(['3000', 'Capital', 0, 250.5]);
    const ok = await importTb(h, sF, e, 'tb.xlsx', Buffer.from(await good.xlsx.writeBuffer()));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().rows).toBe(2);

    const bad = new ExcelJS.Workbook();
    const w2 = bad.addWorksheet('TB');
    w2.addRow(['Code', 'Name', 'Debit', 'Credit']);
    w2.addRow(['1000', 'Cash', { formula: '1+1', result: 2 }, 0]);
    const res = await importTb(h, sF, e, 'tb.xlsx', Buffer.from(await bad.xlsx.writeBuffer()));
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toMatch(/formula/i);
  });

  test('re-importing replaces the trial balance as a new version', async () => {
    const e = await newEngagement();
    await withTrading(e);
    const first = (await call(sF, 'GET', `/engagements/${e}/tb`)).json();
    await importTb(h, sF, e, 'tb2.csv', Buffer.from(csvOf(consultancy.tb)));
    const second = (await call(sF, 'GET', `/engagements/${e}/tb`)).json();
    expect(second.version).toBe(first.version + 1);
    expect(second.lines).toHaveLength(consultancy.tb.length);
  });

  test('a non-member cannot import or read', async () => {
    const e = await newEngagement();
    const outsider = await makeUser(h, T.id, 'senior', 2);
    const so = await login(h, outsider);
    expect((await importTb(h, so, e, 'tb.csv', Buffer.from(csvOf(trading.tb)))).statusCode).toBe(404);
    expect((await call(so, 'GET', `/engagements/${e}/tb`)).statusCode).toBe(404);
  });
});

describe('mapping and statements', () => {
  test('mapping validates line ids; unmapped accounts block the statements', async () => {
    const e = await newEngagement();
    await importTb(h, sF, e, 'tb.csv', Buffer.from(csvOf(trading.tb)));
    expect((await call(sF, 'PUT', `/engagements/${e}/mapping`, { mapping: { '1000': 'not_a_line' } })).statusCode).toBe(422);
    const m = (await call(sF, 'GET', `/engagements/${e}/mapping`)).json();
    expect(m.unmapped.length).toBe(trading.tb.length);
    expect(m.suggestions['1200']).toBe('inventories');
    const blocked = await statements(e);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.map((b: { code: string }) => b.code)).toContain('unmapped');
  });

  test('statements match the hand-calculated profit and balance', async () => {
    const e = await newEngagement();
    await withTrading(e);
    const s = await statements(e);
    expect(s.ok).toBe(true);
    expect(s.statements.pl.profit).toBe(trading.expectedProfit.toString());
    expect(s.statements.sofp.totalAssets).toBe(s.statements.sofp.totalEquityAndLiabilities);
    expect(s.frameworkVersion).toBe('IFRS_SME_2E');
    expect(s.disclosures.length).toBeGreaterThan(5);
  });

  test('an unbalanced trial balance blocks statements and exports', async () => {
    const e = await newEngagement();
    const csv = 'code,name,debit,credit\n1000,Cash,100.00,0\n3000,Capital,0,90.00';
    await importTb(h, sF, e, 'tb.csv', Buffer.from(csv));
    await call(sF, 'PUT', `/engagements/${e}/mapping`, { mapping: { '1000': 'cash', '3000': 'share_capital' } });
    const s = await statements(e);
    expect(s.ok).toBe(false);
    expect(s.blockers.map((b: { code: string }) => b.code)).toContain('unbalanced');
    await stepUp(h, sF, F);
    expect((await call(sF, 'POST', `/engagements/${e}/export`, { format: 'docx' })).statusCode).toBe(409);
  });

  test('no trial balance yet is reported as a blocker, not a crash', async () => {
    const e = await newEngagement();
    const s = await statements(e);
    expect(s.ok).toBe(false);
    expect(s.blockers.map((b: { code: string }) => b.code)).toContain('empty');
  });

  test('a full IFRS client gets a clear 422', async () => {
    const e = await newEngagement(fullIfrsClient);
    await withTrading(e);
    const res = await call(sF, 'GET', `/engagements/${e}/statements`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('framework_not_supported');
  });

  test('the 2027 period uses the third edition', async () => {
    const e = await newEngagement(client, '2027-01-01', '2027-12-31');
    await withTrading(e);
    expect((await statements(e)).frameworkVersion).toBe('IFRS_SME_3E');
  });

  test("statements of another tenant's engagement are 404", async () => {
    const e = await newEngagement();
    const other = await makeTenant(h, 'fin-other');
    const o = await makeUser(h, other.id, 'manager', 3);
    const so = await login(h, o);
    expect((await call(so, 'GET', `/engagements/${e}/statements`)).statusCode).toBe(404);
  });
});

describe('adjustments', () => {
  test('agreed adjustments change the statements; proposed and unadjusted ones do not', async () => {
    const e = await newEngagement();
    await withTrading(e);
    const base = (await statements(e)).statements.pl.profit as string;
    const entry = (status: string, amount: string) => ({
      description: 'Accrue audit fee', status,
      lines: [{ code: '6000', debit: amount, credit: '0.00' }, { code: '2000', debit: '0.00', credit: amount }],
    });
    expect((await call(sM, 'POST', `/engagements/${e}/adjustments`, entry('proposed', '1000.00'))).statusCode).toBe(201);
    expect((await call(sM, 'POST', `/engagements/${e}/adjustments`, entry('unadjusted', '2000.00'))).statusCode).toBe(201);
    expect((await statements(e)).statements.pl.profit).toBe(base);
    expect((await call(sM, 'POST', `/engagements/${e}/adjustments`, entry('agreed', '5000.00'))).statusCode).toBe(201);
    const after = (await statements(e)).statements.pl.profit as string;
    expect(BigInt(base) - BigInt(after)).toBe(500000n);
    const list = (await call(sM, 'GET', `/engagements/${e}/adjustments`)).json();
    expect(list.entries).toHaveLength(3);
    expect(list.unadjustedTotal).toBe('2000.00');
  });

  test('an unbalanced entry or an unknown account is 422', async () => {
    const e = await newEngagement();
    await withTrading(e);
    const unbalanced = { description: 'bad', status: 'agreed', lines: [{ code: '6000', debit: '10.00', credit: '0.00' }, { code: '2000', debit: '0.00', credit: '9.00' }] };
    expect((await call(sM, 'POST', `/engagements/${e}/adjustments`, unbalanced)).statusCode).toBe(422);
    const unknown = { description: 'bad', status: 'agreed', lines: [{ code: '9999', debit: '10.00', credit: '0.00' }, { code: '2000', debit: '0.00', credit: '10.00' }] };
    expect((await call(sM, 'POST', `/engagements/${e}/adjustments`, unknown)).statusCode).toBe(422);
  });
});

describe('prior year carry-forward', () => {
  test('mapping and comparatives carry forward from the clients previous engagement', async () => {
    const c = (await call(sM, 'POST', '/clients', { name: 'Carry Client', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
    const prev = await newEngagement(c, '2025-01-01', '2025-12-31');
    await withTrading(prev);
    const cur = await newEngagement(c, '2026-01-01', '2026-12-31');
    await importTb(h, sF, cur, 'tb.csv', Buffer.from(csvOf(trading.tb)));
    const cf = await call(sF, 'POST', `/engagements/${cur}/financials/carry-forward`);
    expect(cf.statusCode).toBe(200);
    expect(cf.json()).toMatchObject({ carriedMapping: true, carriedPriorYear: true });
    const s = await statements(cur);
    expect(s.ok).toBe(true);
    expect(s.statements.hasComparatives).toBe(true);
    expect(s.statements.cashflow).toBeDefined();
  });

  test('carry-forward reports nothing to carry when there is no previous engagement', async () => {
    const c = (await call(sM, 'POST', '/clients', { name: 'First Year Client', sector: 'trading', legalForm: 'sole', yearEndMonth: 12 })).json().id;
    const e = await newEngagement(c);
    expect((await call(sF, 'POST', `/engagements/${e}/financials/carry-forward`)).json()).toMatchObject({ carriedMapping: false, carriedPriorYear: false });
    await withTrading(e);
    const s = await statements(e);
    expect(s.statements.hasComparatives).toBe(false);
    expect(s.exceptions.map((x: { code: string }) => x.code)).toContain('no-comparatives');
  });
});

describe('exports', () => {
  test('need step-up, are non-empty in each format and DRAFT until the engagement is partner-approved', async () => {
    const e = await newEngagement();
    await withTrading(e);
    h.clock.t += 30_000;
    const fresh = await login(h, F);
    expect((await call(fresh, 'POST', `/engagements/${e}/export`, { format: 'docx' })).statusCode).toBe(401);
    expect((await call(sF, 'POST', `/engagements/${e}/export`, { format: 'exe' })).statusCode).toBe(400);

    await stepUp(h, sF, F);
    for (const [format, type] of [['docx', 'wordprocessingml'], ['xlsx', 'spreadsheetml'], ['pdf', 'pdf']] as const) {
      const res = await call(sF, 'POST', `/engagements/${e}/export`, { format });
      expect(res.statusCode, format).toBe(200);
      expect(res.headers['content-type']).toContain(type);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.rawPayload.length).toBeGreaterThan(1000);
    }
    const draft = await call(sF, 'POST', `/engagements/${e}/export`, { format: 'pdf' });
    expect(draft.rawPayload.toString('latin1')).toContain('DRAFT');

    for (const s of ['planning', 'fieldwork', 'completion', 'review', 'partner_approved']) {
      await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    }
    const final = await call(sF, 'POST', `/engagements/${e}/export`, { format: 'pdf' });
    expect(final.statusCode).toBe(200);
    expect(final.rawPayload.toString('latin1')).not.toContain('DRAFT');
  });

  test('every export is written to the audit trail', async () => {
    const e = await newEngagement();
    await withTrading(e);
    await stepUp(h, sF, F);
    await call(sF, 'POST', `/engagements/${e}/export`, { format: 'xlsx' });
    const r = await h.owner.query("select detail from audit_events where tenant_id = $1 and action = 'export.created' and entity_id = $2", [T.id, e]);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].detail).toMatchObject({ format: 'xlsx', draft: true });
  });
});

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
const realPng = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const pdfText = (buf: Buffer): string => {
  const hex = (x: string) => Buffer.from(x, 'hex').toString('latin1');
  const out: string[] = [];
  for (const m of buf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hex(x[1]!)).join(''));
    else out.push(hex(m[2]!));
  }
  return out.join('\n');
};

describe('branding on exported statements', () => {
  test('a firm without saved branding still gets its name and Powered by AuditOS', async () => {
    const e = await newEngagement();
    await withTrading(e);
    await stepUp(h, sF, F);
    const t = pdfText((await call(sF, 'POST', `/engagements/${e}/export`, { format: 'pdf' })).rawPayload);
    expect(t).toContain('Powered by AuditOS');
    expect(t).toContain('Fin Client Ltd');
  });

  test('the current branding (name, contact line, note, logo) appears in the PDF and the Excel file, and changes follow at once', async () => {
    const e = await newEngagement();
    await withTrading(e);
    await stepUp(h, sP, P);
    expect((await call(sP, 'PUT', '/billing/settings', { legalName: 'Kangethe & Associates', address: 'Old Street 1, Nairobi', kraPin: 'P051234567Q', invoicePrefix: 'KA', quotePrefix: 'KQ', bankDetails: 'Bank' })).statusCode).toBe(200);
    expect((await call(sA, 'PUT', '/branding', { primary: '#1f5f4a', secondary: '#e8c547', phone: '+254 700 111 222', email: 'old@firm.example.test', website: 'https://old.firm.example.test', footerNote: 'Old footer note' })).statusCode).toBe(200);
    const m = multipartBody('logo.png', realPng());
    expect((await h.app.inject({ method: 'POST', url: '/branding/logo', headers: { ...sA.headers, 'content-type': m.contentType }, payload: m.payload })).statusCode).toBe(200);

    const pdf = (await call(sP, 'POST', `/engagements/${e}/export`, { format: 'pdf' })).rawPayload;
    const t = pdfText(pdf);
    for (const s of ['Kangethe & Associates', 'Tel: +254 700 111 222', 'old@firm.example.test', 'Old footer note', 'Powered by AuditOS']) expect(t, s).toContain(s);
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await call(sP, 'POST', `/engagements/${e}/export`, { format: 'xlsx' })).rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Financial position')!;
    expect(String(ws.getCell('A1').value)).toContain('Kangethe & Associates');
    expect(String(ws.getRow(ws.rowCount).getCell(1).value)).toContain('Powered by AuditOS');

    // Statements are live: a later change shows on the next export (unlike an issued invoice).
    expect((await call(sA, 'PUT', '/branding', { primary: '#1f5f4a', secondary: '#e8c547', phone: '+254 711 999 888', email: 'new@firm.example.test', website: '', footerNote: '' })).statusCode).toBe(200);
    expect((await call(sA, 'DELETE', '/branding/logo')).statusCode).toBeLessThan(300);
    const after = (await call(sP, 'POST', `/engagements/${e}/export`, { format: 'pdf' })).rawPayload;
    expect(pdfText(after)).toContain('+254 711 999 888');
    expect(pdfText(after)).not.toContain('Old footer note');
    expect(after.toString('latin1')).not.toContain('/Subtype /Image');
  });
});

describe('financial gates', () => {
  test('completion needs a balanced, mapped trial balance; review needs the disclosure checklist', async () => {
    const e = await newEngagement();
    const gates = async (to: string) => {
      const r = await call(sM, 'POST', `/engagements/${e}/transition`, { to });
      return { status: r.statusCode, gates: (r.json().blockers ?? []).map((b: { gate: string }) => b.gate) as string[] };
    };
    for (const s of ['planning', 'fieldwork']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    expect((await gates('completion')).gates).toContain('trialBalanceMappedAndBalanced');
    await withTrading(e);
    expect((await gates('completion')).gates).not.toContain('trialBalanceMappedAndBalanced');

    await ownerQuery(h, T.id, "update engagements set state = 'completion' where id = $1", [e]);
    expect((await gates('review')).gates).toContain('disclosureChecklistComplete');
  });

  test('an engagement flagged for EQR cannot be partner-approved without an approved eqr_review item', async () => {
    const e = await newEngagement();
    await ownerQuery(h, T.id, "update engagements set risk_profile = '{\"riskFlags\":[\"eqr_required\"]}' where id = $1", [e]);
    for (const s of ['planning', 'fieldwork', 'completion', 'review']) await ownerQuery(h, T.id, 'update engagements set state = $2 where id = $1', [e, s]);
    await stepUp(h, sP, P);
    const r = await call(sP, 'POST', `/engagements/${e}/transition`, { to: 'partner_approved' });
    expect(r.statusCode).toBe(409);
    expect(r.json().blockers.map((b: { gate: string }) => b.gate)).toContain('eqrSignedOffWhereRequired');
  });
});
