import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, multipartBody, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let A: TestUser, P: TestUser, M: TestUser;
let sA: Session, sP: Session, sM: Session;
let client: string;
let logoId: string;
let oldPrimary: string;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
/** A real, decodable PNG (so the PDF embeds it as an image). */
const realPng = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const upload = (s: Session, data: Buffer) => {
  const m = multipartBody('logo.png', data);
  return h.app.inject({ method: 'POST', url: '/branding/logo', headers: { ...s.headers, 'content-type': m.contentType }, payload: m.payload });
};

/** The text drawn on the pages: pdfkit writes it as hex strings, so each text-showing operation is joined back up. */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const hex = (x: string) => Buffer.from(x, 'hex').toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hex(x[1]!)).join(''));
    else out.push(hex(m[2]!));
  }
  return out.join('\n');
}
const hasImage = (b: Buffer) => b.toString('latin1').includes('/Subtype /Image');
const pdf = async (s: Session, url: string) => {
  const r = await call(s, 'GET', url);
  expect(r.statusCode).toBe(200);
  return r.rawPayload;
};

/** Changes the database behind the API's back, the way an old release or a damaged row would. */
async function tamper(sql: string[]): Promise<void> {
  const c = await h.owner.connect();
  try {
    await c.query('BEGIN');
    await c.query("select set_config('app.tenant_id', $1, true)", [T.id]);
    await c.query("select set_config('app.user_id', $1, true)", [A.id]);
    await c.query("select set_config('app.invoicing', 'on', true)");
    for (const q of sql) await c.query(q);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

const newInvoice = async (s = sM) => (await call(s, 'POST', '/invoices', { clientId: client, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Audit fee', quantity: '1', unitPrice: '100000.00' }] })).json().id as string;
const issued = async (): Promise<string> => {
  const id = await newInvoice();
  expect((await call(sP, 'POST', `/invoices/${id}/issue`, {})).statusCode).toBe(200);
  return id;
};
const newQuote = async () => (await call(sM, 'POST', '/quotes', { clientId: client, title: 'Audit of FY2026', taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Statutory audit', quantity: '1', unitPrice: '400000.00' }] })).json().id as string;
const get = async (s: Session, url: string) => (await call(s, 'GET', url)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'letterhead');
  A = await makeUser(h, T.id, 'firm_admin', 0);
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  sA = await login(h, A);
  sP = await login(h, P);
  sM = await login(h, M);
  for (const s of [sP, sM]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  await call(sP, 'PUT', '/billing/settings', { legalName: 'Kangethe & Associates', address: 'Old Street 1, Nairobi', kraPin: 'P051234567Q', invoicePrefix: 'KA', quotePrefix: 'KQ', bankDetails: 'Old Bank, account 111' });
  await call(sA, 'PUT', '/branding', { primary: '#1f5f4a', secondary: '#e8c547', phone: '+254 700 111 222', email: 'old@firm.example.test', website: 'https://old.firm.example.test', footerNote: 'Old footer note' });
  logoId = (await upload(sA, realPng())).json().logoId;
  oldPrimary = (await get(sA, '/branding')).branding.primary;
  client = (await call(sM, 'POST', '/clients', { name: 'Letterhead Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('an invoice keeps the letterhead it was issued with', () => {
  let inv: string;
  let quote: string;

  test('a draft shows the current letterhead; issuing freezes a copy on the invoice', async () => {
    inv = await newInvoice();
    const d = await get(sM, `/invoices/${inv}`);
    expect(d.letterheadIsLive).toBe(true);
    expect(d.letterhead).toMatchObject({ name: 'Kangethe & Associates', address: 'Old Street 1, Nairobi', phone: '+254 700 111 222', email: 'old@firm.example.test', website: 'https://old.firm.example.test', kraPin: 'P051234567Q', footerNote: 'Old footer note', logoId, primary: oldPrimary });

    expect((await call(sP, 'POST', `/invoices/${inv}/issue`, {})).statusCode).toBe(200);
    const i = await get(sM, `/invoices/${inv}`);
    expect(i.letterheadIsLive).toBe(false);
    expect(i.letterhead).toMatchObject({ name: 'Kangethe & Associates', logoId, primary: oldPrimary });
    const row = await ownerQuery(h, T.id, 'select letterhead from invoices where id = $1', [inv], A.id);
    expect(row.rows[0].letterhead).toMatchObject({ name: 'Kangethe & Associates', logoId });
  });

  test('a quotation is frozen the same way when it is sent', async () => {
    quote = await newQuote();
    expect((await get(sM, `/quotes/${quote}`)).letterheadIsLive).toBe(true);
    expect((await call(sM, 'POST', `/quotes/${quote}/send`, {})).statusCode).toBe(200);
    const q = await get(sM, `/quotes/${quote}`);
    expect(q.letterheadIsLive).toBe(false);
    expect(q.letterhead).toMatchObject({ name: 'Kangethe & Associates', address: 'Old Street 1, Nairobi', logoId, primary: oldPrimary });
  });

  test('the firm then changes its name, address, colour and logo: the issued documents do not move, a new draft does', async () => {
    expect((await call(sP, 'PUT', '/billing/settings', { legalName: 'Renamed & Co', address: 'New Road 9, Mombasa', bankDetails: 'New Bank, account 222' })).statusCode).toBe(200);
    expect((await call(sA, 'PUT', '/branding', { primary: '#7a1f1f', secondary: '#e8c547', phone: '+254 711 999 888', email: 'new@firm.example.test', website: 'https://new.firm.example.test', footerNote: 'New footer note' })).statusCode).toBe(200);
    expect((await call(sA, 'DELETE', '/branding/logo')).statusCode).toBe(200);

    const i = await get(sM, `/invoices/${inv}`);
    expect(i.letterhead).toMatchObject({ name: 'Kangethe & Associates', address: 'Old Street 1, Nairobi', phone: '+254 700 111 222', footerNote: 'Old footer note', logoId, primary: oldPrimary });
    const q = await get(sM, `/quotes/${quote}`);
    expect(q.letterhead).toMatchObject({ name: 'Kangethe & Associates', logoId, primary: oldPrimary });

    const d = await get(sM, `/invoices/${await newInvoice()}`);
    expect(d.letterheadIsLive).toBe(true);
    expect(d.letterhead).toMatchObject({ name: 'Renamed & Co', address: 'New Road 9, Mombasa', logoId: null, footerNote: 'New footer note' });
    expect(d.letterhead.primary).not.toBe(oldPrimary);
  });

  test('the issued invoice PDF still has the old letterhead and the old logo', async () => {
    const buf = await pdf(sM, `/invoices/${inv}/pdf`);
    const t = pdfText(buf);
    for (const s of ['Kangethe & Associates', 'Old Street 1, Nairobi', '+254 700 111 222', 'old@firm.example.test', 'https://old.firm.example.test', 'P051234567Q', 'Old footer note', 'Powered by AuditOS', 'Old Bank, account 111']) expect(t, s).toContain(s);
    for (const s of ['Renamed', 'New Road', 'New footer note', 'New Bank']) expect(t, s).not.toContain(s);
    expect(hasImage(buf)).toBe(true);
  });

  test('the sent quotation PDF still has the old letterhead and logo, with the payment details', async () => {
    const buf = await pdf(sM, `/quotes/${quote}/pdf`);
    const t = pdfText(buf);
    for (const s of ['Kangethe & Associates', 'Old Street 1, Nairobi', 'Old footer note', 'Powered by AuditOS', 'Old Bank, account 111']) expect(t, s).toContain(s);
    expect(t).not.toContain('Renamed');
    expect(hasImage(buf)).toBe(true);
  });

  test('a draft PDF uses the current letterhead and has no logo any more', async () => {
    const buf = await pdf(sM, `/invoices/${await newInvoice()}/pdf`);
    const t = pdfText(buf);
    expect(t).toContain('Renamed & Co');
    expect(t).toContain('New footer note');
    expect(t).toContain('Powered by AuditOS');
    expect(t).not.toContain('Old footer note');
    expect(hasImage(buf)).toBe(false);
  });

  test('the saved email is the letterhead as text, the message, then Powered by AuditOS', async () => {
    expect((await call(sM, 'POST', `/invoices/${inv}/send`, { to: 'client@example.test' })).statusCode).toBe(200);
    const mails = (await get(sM, '/outbox')).messages as { refId: string; body: string; subject: string }[];
    const m = mails.find((x) => x.refId === inv)!;
    expect(m.subject).toContain('Kangethe & Associates');
    const lines = m.body.split('\n');
    expect(lines.slice(0, 5)).toEqual(['Kangethe & Associates', 'Old Street 1, Nairobi', 'Tel: +254 700 111 222', 'Email: old@firm.example.test', 'Web: https://old.firm.example.test']);
    expect(lines[lines.length - 1]).toBe('Powered by AuditOS');
    expect(m.body).toContain('Amount due: KES');
    expect(m.body).not.toContain('Renamed');
  });

  test('a letterhead cannot be rewritten once set', async () => {
    const r = await h.owner.connect();
    try {
      await r.query('BEGIN');
      await r.query("select set_config('app.tenant_id', $1, true)", [T.id]);
      await r.query("select set_config('app.user_id', $1, true)", [P.id]);
      await expect(r.query('select invoice_set_letterhead($1, $2::jsonb)', [inv, JSON.stringify({ name: 'Other' })])).rejects.toThrow(/letterhead_frozen/);
    } finally {
      await r.query('ROLLBACK');
      r.release();
    }
  });
});

describe('damaged or missing logos never stop a document', () => {
  test('a logo row whose bytes are not a picture still gives a PDF, with the name instead', async () => {
    const id = randomUUID();
    await tamper([
      `insert into firm_logos (id, tenant_id, content_type, bytes, width, height) values ('${id}', '${T.id}', 'image/png', decode('89504e470d0a1a0a6e6f742061207069637475726521', 'hex'), 10, 10)`,
      `update firm_branding set logo_id = '${id}' where tenant_id = '${T.id}'`,
    ]);
    const inv = await issued();
    expect((await get(sM, `/invoices/${inv}`)).letterhead.logoId).toBe(id);
    const buf = await pdf(sM, `/invoices/${inv}/pdf`);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfText(buf)).toContain('Renamed & Co');
    expect(pdfText(buf)).toContain('Powered by AuditOS');
  });

  test('a snapshot that names a logo that is gone gives a PDF with the name instead', async () => {
    const inv = await issued();
    await tamper([
      'alter table invoices disable trigger invoices_letterhead_guard',
      `update invoices set letterhead = jsonb_set(letterhead, '{logoId}', '"${randomUUID()}"') where id = '${inv}'`,
      'alter table invoices enable trigger invoices_letterhead_guard',
    ]);
    const buf = await pdf(sM, `/invoices/${inv}/pdf`);
    expect(hasImage(buf)).toBe(false);
    expect(pdfText(buf)).toContain('Renamed & Co');
  });
});

describe('documents issued before letterheads existed', () => {
  test('fall back to the current letterhead and say it is live; nothing is written to them', async () => {
    const inv = await issued();
    const quote = await newQuote();
    await call(sM, 'POST', `/quotes/${quote}/send`, {});
    await tamper([
      'alter table invoices disable trigger invoices_letterhead_guard',
      'alter table quotes disable trigger quotes_letterhead_guard',
      `update invoices set letterhead = null where id = '${inv}'`,
      `update quotes set letterhead = null where id = '${quote}'`,
      'alter table invoices enable trigger invoices_letterhead_guard',
      'alter table quotes enable trigger quotes_letterhead_guard',
    ]);
    const i = await get(sM, `/invoices/${inv}`);
    expect(i.letterheadIsLive).toBe(true);
    expect(i.letterhead.name).toBe('Renamed & Co');
    expect((await get(sM, `/quotes/${quote}`)).letterheadIsLive).toBe(true);
    expect(pdfText(await pdf(sM, `/invoices/${inv}/pdf`))).toContain('Renamed & Co');
    expect(pdfText(await pdf(sM, `/quotes/${quote}/pdf`))).toContain('Powered by AuditOS');
    const row = await ownerQuery(h, T.id, 'select letterhead from invoices where id = $1', [inv], A.id);
    expect(row.rows[0].letterhead).toBeNull();
  });
});

describe('sending a quotation with an email address', () => {
  test('keeps an email with the letterhead that was frozen on the quotation, and the firm name in the subject', async () => {
    const q = await newQuote();
    const sent = await call(sM, 'POST', `/quotes/${q}/send`, { to: 'prospect@example.test' });
    expect(sent.statusCode).toBe(200);
    const { number, outboxId } = sent.json() as { number: string; outboxId: string };
    expect(outboxId).toBeTruthy();
    const frozen = (await get(sM, `/quotes/${q}`)).letterhead as { name: string };
    const mail = ((await get(sM, '/outbox')).messages as { id: string; subject: string; body: string }[]).find((m) => m.id === outboxId)!;
    expect(mail.subject).toBe(`Quotation ${number} from ${frozen.name}`);
    const lines = mail.body.split('\n');
    expect(lines.slice(0, 5)).toEqual(['Renamed & Co', 'New Road 9, Mombasa', 'Tel: +254 711 999 888', 'Email: new@firm.example.test', 'Web: https://new.firm.example.test']);
    expect(lines[lines.length - 1]).toBe('Powered by AuditOS');
    expect(mail.body).toContain('Total: KES');
  });
});
