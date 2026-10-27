import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { createPools } from '@auditos/db';
import { buildApp } from '../src/app';
import { validateUpload } from '../src/evidence/validate';
import { login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

describe('validateUpload', () => {
  test('accepts a real pdf and returns its sha256 and a safe name', () => {
    const r = validateUpload('Bank Statement.PDF', PDF);
    expect(r).toMatchObject({ ok: true, safeName: 'Bank_Statement.pdf', mime: 'application/pdf' });
    if (r.ok) expect(r.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
  });
  test('rejects an extension and magic-byte mismatch', () => {
    expect(validateUpload('report.pdf', PNG)).toMatchObject({ ok: false });
    expect(validateUpload('photo.png', PDF)).toMatchObject({ ok: false });
  });
  test('rejects zero-byte and oversized files', () => {
    expect(validateUpload('a.pdf', Buffer.alloc(0))).toMatchObject({ ok: false, reason: expect.stringMatching(/empty/i) });
    expect(validateUpload('a.pdf', Buffer.concat([PDF, Buffer.alloc(25 * 1024 * 1024)]))).toMatchObject({ ok: false, reason: expect.stringMatching(/large/i) });
  });
  test.each(['page.html', 'logo.svg', 'run.exe', 'script.js', 'noext', 'archive.zip', 'x.pdf.exe'])('rejects %s by extension', (name) => {
    expect(validateUpload(name, PDF)).toMatchObject({ ok: false });
  });
  test('sanitises path traversal and control characters in names', () => {
    const r = validateUpload('../../etc/passwd\u0000.png', PNG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.safeName).not.toMatch(/[\\/\u0000]/);
      expect(r.safeName.endsWith('.png')).toBe(true);
    }
    const r2 = validateUpload('..\\..\\windows\\system32\\evil.pdf', PDF);
    if (r2.ok) expect(r2.safeName).toBe('evil.pdf');
  });
  test('accepts docx/xlsx as zip containers, and text only when it is valid utf-8 without NULs', () => {
    expect(validateUpload('tb.xlsx', ZIP)).toMatchObject({ ok: true });
    expect(validateUpload('notes.txt', Buffer.from('hello, wörld'))).toMatchObject({ ok: true });
    expect(validateUpload('notes.txt', Buffer.from([0x68, 0x00, 0x69]))).toMatchObject({ ok: false });
    expect(validateUpload('data.csv', Buffer.from([0xff, 0xfe, 0xfd]))).toMatchObject({ ok: false });
  });
});

let h: Harness;
let T: TestTenant;
let M: TestUser, F: TestUser, OUT: TestUser;
let sM: Session, sF: Session, sOut: Session;
let engId: string;
let uploadDir: string;
let quarantine = false;

const multipart = (filename: string, data: Buffer, fields: Record<string, string> = {}) => {
  const boundary = '----auditos' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
};

const upload = (s: Session, filename: string, data: Buffer, fields: Record<string, string> = {}, engagement = engId) => {
  const m = multipart(filename, data, fields);
  return h.app.inject({
    method: 'POST',
    url: `/engagements/${engagement}/evidence`,
    headers: { ...s.headers, 'content-type': m.contentType },
    payload: m.payload,
  });
};

beforeAll(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), 'auditos-evidence-'));
  const { owner, app: appPool } = createPools();
  const clock = { t: Date.now() };
  const app = await buildApp({
    env: { ...process.env, LOGIN_RATE_LIMIT: '1000', UPLOAD_DIR: uploadDir },
    pools: { app: appPool },
    now: () => clock.t,
    scanner: { scan: async () => ({ clean: !quarantine }) },
  });
  h = { app, owner, clock, close: async () => { await app.close(); await owner.end(); await appPool.end(); } };
  T = await makeTenant(h, 'evidence');
  const P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OUT = await makeUser(h, T.id, 'manager', 3);
  const sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  sOut = await login(h, OUT);
  for (const s of [sP, sM, sF, sOut]) await h.app.inject({ method: 'POST', url: '/independence', headers: s.headers, payload: { statement: 'No relationships that impair independence.' } });
  const c = await h.app.inject({ method: 'POST', url: '/clients', headers: sM.headers, payload: { name: 'Evidence Client', sector: 'trading', legalForm: 'sole', yearEndMonth: 12 } });
  const e = await h.app.inject({ method: 'POST', url: '/engagements', headers: sM.headers, payload: { clientId: c.json().id, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id } });
  engId = e.json().id;
  await h.app.inject({ method: 'POST', url: `/engagements/${engId}/members`, headers: sM.headers, payload: { userId: F.id } });
});
afterAll(async () => h.close());

describe('evidence upload and download', () => {
  test('stores sha256, returns identical bytes on download and writes it into the audit trail', async () => {
    const res = await upload(sF, 'Bank Rec.pdf', PDF);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Bank_Rec.pdf', size: PDF.length, scanStatus: 'clean', sha256: createHash('sha256').update(PDF).digest('hex') });
    const dl = await h.app.inject({ method: 'GET', url: `/evidence/${res.json().id}/download`, headers: sF.headers });
    expect(dl.statusCode).toBe(200);
    expect(Buffer.from(dl.rawPayload).equals(PDF)).toBe(true);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    const ev = await h.owner.query("select 1 from audit_events where tenant_id = $1 and action = 'item.created' and entity_id = $2", [T.id, res.json().id]);
    expect(ev.rowCount).toBe(1);
  });

  test('rejects an extension and magic-byte mismatch with 422', async () => {
    expect((await upload(sF, 'fake.pdf', PNG)).statusCode).toBe(422);
  });

  test('rejects hostile file types with 422 and oversized files with 413', async () => {
    expect((await upload(sF, 'evil.html', Buffer.from('<script>alert(1)</script>'))).statusCode).toBe(422);
    expect((await upload(sF, 'big.pdf', Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]))).statusCode).toBe(413);
    expect((await upload(sF, 'empty.pdf', Buffer.alloc(0))).statusCode).toBe(422);
  });

  test('a traversal filename is sanitised and the object key is generated, not derived from the name', async () => {
    const res = await upload(sF, '../../etc/passwd.png', PNG);
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('passwd.png');
    const key = (await ownerQuery(h, T.id, "select content->>'storageKey' as k from wp_items where id = $1", [res.json().id], F.id)).rows[0].k as string;
    expect(key).toMatch(new RegExp(`^${T.id}/${engId}/[0-9a-f-]{36}$`));
  });

  test('a download of another tenant’s or non-member’s file is 404', async () => {
    const res = await upload(sF, 'private.pdf', PDF);
    expect((await h.app.inject({ method: 'GET', url: `/evidence/${res.json().id}/download`, headers: sOut.headers })).statusCode).toBe(404);
  });

  test('a file that fails the scan is quarantined and not downloadable', async () => {
    quarantine = true;
    const res = await upload(sF, 'suspicious.pdf', PDF);
    quarantine = false;
    expect(res.statusCode).toBe(201);
    expect(res.json().scanStatus).toBe('quarantined');
    const dl = await h.app.inject({ method: 'GET', url: `/evidence/${res.json().id}/download`, headers: sF.headers });
    expect(dl.statusCode).toBe(409);
  });

  test('evidence content cannot be edited, and it can be linked to a working paper item', async () => {
    const paper = await h.app.inject({ method: 'POST', url: `/engagements/${engId}/items`, headers: sF.headers, payload: { kind: 'workpaper', title: 'Bank', content: {} } });
    const res = await upload(sF, 'link.pdf', PDF, { itemId: paper.json().id });
    expect(res.statusCode).toBe(201);
    const got = (await h.app.inject({ method: 'GET', url: `/items/${res.json().id}`, headers: sF.headers })).json();
    expect(got.content.parentItemId).toBe(paper.json().id);
    const edit = await h.app.inject({ method: 'PATCH', url: `/items/${res.json().id}`, headers: sF.headers, payload: { title: 'renamed' } });
    expect(edit.statusCode).toBe(409);
  });

  test('a linked item id from another engagement is refused', async () => {
    const res = await upload(sF, 'bad-link.pdf', PDF, { itemId: '00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(422);
  });

  test('uploads are visible in the evidence list for the engagement', async () => {
    const list = (await h.app.inject({ method: 'GET', url: `/engagements/${engId}/items?kind=evidence`, headers: sF.headers })).json().items;
    expect(list.length).toBeGreaterThan(3);
    expect(list.every((i: { kind: string }) => i.kind === 'evidence')).toBe(true);
  });

  test('a non-member cannot upload to the engagement', async () => {
    expect((await upload(sOut, 'x.pdf', PDF)).statusCode).toBe(404);
  });
});
