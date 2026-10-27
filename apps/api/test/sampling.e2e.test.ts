import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, multipartBody, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P2: TestUser, M: TestUser, M2: TestUser, F: TestUser, OS: TestUser;
let sP2: Session, sM: Session, sM2: Session, sF: Session, sOS: Session;
let eng: string, otherEng: string, evidenceId: string, foreignEvidence: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (s: Session, method: Method, url: string, payload?: object) => h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const upload = (s: Session, filename: string, text: string, fields: Record<string, string>) => {
  const m = multipartBody(filename, Buffer.from(text, 'utf8'), fields);
  return h.app.inject({ method: 'POST', url: `/engagements/${eng}/sampling`, headers: { ...s.headers, 'content-type': m.contentType }, payload: m.payload });
};
const POP = ['Invoice,Description,Amount', ...Array.from({ length: 60 }, (_, i) => `INV-${String(i + 1).padStart(3, '0')},Supplier ${i + 1},"${(1000 + i * 250).toLocaleString('en-US')}.00"`)].join('\n');
const draw = (over: Record<string, string> = {}) => upload(sF, 'payables.csv', POP, { title: 'Trade payables', method: 'random', size: '10', seed: 'fixed-seed', ...over });
const detail = async (sid: string, s = sF) => (await call(s, 'GET', `/engagements/${eng}/sampling/${sid}`)).json();
const trail = async () => (await call(sM, 'GET', '/audit-trail?limit=100')).json().events as { sentence: string }[];

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'sampling');
  const P = await makeUser(h, T.id, 'partner', 4);
  P2 = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  M2 = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  OS = await makeUser(h, T.id, 'staff', 1);
  const sP = await login(h, P);
  sP2 = await login(h, P2);
  sM = await login(h, M);
  sM2 = await login(h, M2);
  sF = await login(h, F);
  sOS = await login(h, OS);
  for (const s of [sP, sP2, sM, sM2, sF, sOS]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const client = (await call(sM, 'POST', '/clients', { name: 'Mwangaza Traders Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  eng = (await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${eng}/members`, { userId: F.id });
  const client2 = (await call(sM2, 'POST', '/clients', { name: 'Other Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  otherEng = (await call(sM2, 'POST', '/engagements', { clientId: client2, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  const ev = (eng_: string, userId: string, title: string) =>
    ownerQuery(h, T.id, "insert into wp_items (tenant_id, engagement_id, kind, title, created_by) values ($1, $2, 'evidence', $3, $4) returning id", [T.id, eng_, title, userId], userId);
  evidenceId = (await ev(eng, F.id, 'Supplier invoice INV-005.pdf')).rows[0].id;
  foreignEvidence = (await ev(otherEng, M2.id, 'Someone elses file.pdf')).rows[0].id;
});
afterAll(async () => h.close());

describe('drawing a sample', () => {
  test('a random sample from an uploaded population records the method, seed and a fingerprint of the population', async () => {
    const r = await draw();
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ seed: 'fixed-seed', selected: 10, populationCount: 60 });
    const d = await detail(r.json().id);
    expect(d).toMatchObject({ title: 'Trade payables', method: 'random', seed: 'fixed-seed', requestedSize: 10, populationCount: 60 });
    expect(d.populationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(d.items).toHaveLength(10);
    expect(d.summary).toMatchObject({ selected: 10, pending: 10, complete: false });
  });

  test('the same population and seed draw exactly the same items, so the selection can be reproduced', async () => {
    const a = await detail((await draw()).json().id);
    const b = await detail((await draw()).json().id);
    expect(a.items.map((i: { ref: string }) => i.ref)).toEqual(b.items.map((i: { ref: string }) => i.ref));
    expect(a.populationFingerprint).toBe(b.populationFingerprint);
  });

  test('without a seed one is made up and kept, so even that draw can be repeated', async () => {
    const r = await draw({ seed: '' });
    expect(r.statusCode).toBe(201);
    expect(r.json().seed).toMatch(/^[0-9a-f]{12}$/);
  });

  test('monetary-unit sampling records the interval and flags key items; top items takes the largest', async () => {
    const m = await detail((await draw({ method: 'monetary_unit', size: '8' })).json().id);
    expect(m.interval).not.toBeNull();
    expect(m.items.every((i: { reason: string }) => ['interval', 'key_item'].includes(i.reason))).toBe(true);
    const t = await detail((await draw({ method: 'top', size: '3' })).json().id);
    expect(t.items.map((i: { ref: string }) => i.ref)).toEqual(['INV-058', 'INV-059', 'INV-060']);
    expect(t.items.every((i: { reason: string }) => i.reason === 'top')).toBe(true);
  });

  test('a population with an unreadable amount is refused with the row, never sampled with rows missing', async () => {
    const r = await upload(sF, 'bad.csv', 'Invoice,Amount\nA-1,1000.00\nA-2,not money\nA-3,500.00', { title: 'Bad', method: 'random', size: '2' });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: 'unreadable_rows', rows: [{ row: 3 }] });
  });

  test('other refusals say why: no amount column, wrong type, empty, a missing title', async () => {
    expect((await upload(sF, 'x.csv', 'a,b\n1,2', { title: 'T', method: 'random', size: '2' })).json().error).toBe('no_amount_column');
    expect((await upload(sF, 'x.exe', 'MZ', { title: 'T', method: 'random', size: '2' })).statusCode).toBe(415);
    expect((await upload(sF, 'x.csv', 'Invoice,Amount', { title: 'T', method: 'random', size: '2' })).json().error).toBe('empty_population');
    expect((await upload(sF, 'x.csv', POP, { title: '', method: 'random', size: '2' })).statusCode).toBe(400);
    expect((await upload(sF, 'x.csv', POP, { title: 'T', method: 'random', size: '0' })).statusCode).toBe(400);
  });

  test('only the engagement team can draw one', async () => {
    for (const s of [sOS, sM2, sP2]) {
      const m = multipartBody('p.csv', Buffer.from(POP), { title: 'T', method: 'random', size: '5' });
      const r = await h.app.inject({ method: 'POST', url: `/engagements/${eng}/sampling`, headers: { ...s.headers, 'content-type': m.contentType }, payload: m.payload });
      expect(r.statusCode).toBe(404);
    }
  });

  test('the draw is in the audit trail in plain English', async () => {
    expect((await trail()).map((e) => e.sentence).join('\n')).toMatch(/drew a random sample of 10 from 60 items for "Trade payables" for Mwangaza Traders Ltd/);
  });
});

describe('recording results', () => {
  let sid: string;
  let items: { id: string; ref: string; amount: string }[];
  beforeAll(async () => {
    sid = (await draw({ seed: 'results' })).json().id;
    items = (await detail(sid)).items;
  });
  const mark = (i: number, body: object, s = sF) => call(s, 'PATCH', `/engagements/${eng}/sampling/${sid}/items/${items[i]!.id}`, body);

  test('an item is supported, with who and when recorded', async () => {
    expect((await mark(0, { result: 'supported' })).statusCode).toBe(200);
    const it = (await detail(sid)).items[0];
    expect(it).toMatchObject({ result: 'supported', testedBy: expect.any(String), misstatement: null });
    expect(it.testedAt).toBeTruthy();
  });

  test('an exception needs an amount and a note', async () => {
    expect((await mark(1, { result: 'exception' })).json().error ?? (await mark(1, { result: 'exception' })).statusCode).toBeTruthy();
    expect((await mark(1, { result: 'exception', misstatement: '500.00' })).statusCode).toBe(422);
    expect((await mark(1, { result: 'exception', note: 'Invoice is for a different supplier' })).statusCode).toBe(422);
    expect((await mark(1, { result: 'exception', misstatement: '1,500.00', note: 'Invoice is for a different supplier' })).statusCode).toBe(200);
    expect((await detail(sid)).items[1]).toMatchObject({ result: 'exception', misstatement: '1500.00' });
  });

  test('not tested needs a reason, and a supported result clears any earlier misstatement', async () => {
    expect((await mark(2, { result: 'not_tested' })).statusCode).toBe(422);
    expect((await mark(2, { result: 'not_tested', note: 'Supplier closed, no records' })).statusCode).toBe(200);
    await mark(1, { result: 'supported' });
    expect((await detail(sid)).items[1]).toMatchObject({ result: 'supported', misstatement: null });
    await mark(1, { result: 'exception', misstatement: '1500.00', note: 'Invoice is for a different supplier' });
  });

  test('a receipt or invoice can be linked from the engagement file, but not from another engagement', async () => {
    expect((await mark(3, { result: 'supported', evidenceItemId: evidenceId })).statusCode).toBe(200);
    expect((await detail(sid)).items[3].evidence).toMatchObject({ id: evidenceId, title: 'Supplier invoice INV-005.pdf' });
    expect((await mark(4, { result: 'supported', evidenceItemId: foreignEvidence })).statusCode).toBe(422);
  });

  test('the summary counts results and shows what the exceptions might mean, as an indication only', async () => {
    const s = (await detail(sid)).summary;
    expect(s).toMatchObject({ selected: 10, supported: 2, exceptions: 1, notTested: 1, pending: 6, misstatementFound: '1500.00', exceptionRate: '33.3%', complete: false });
    expect(s.projected).toBe('30000.00'); // 1,500 over 3 tested items, times 60 items in the population
    expect(s.note).toMatch(/judgement/i);
  });

  test('every result is logged, with the note', async () => {
    const t = (await trail()).map((e) => e.sentence).join('\n');
    expect(t).toMatch(/marked item INV-\d+ of "Trade payables" for Mwangaza Traders Ltd as an exception. Note: "Invoice is for a different supplier"/);
    expect(t).toMatch(/as not tested. Note: "Supplier closed, no records"/);
  });

  test('a schedule with results cannot be deleted; an untouched one can, and that is logged', async () => {
    expect((await call(sF, 'DELETE', `/engagements/${eng}/sampling/${sid}`)).statusCode).toBe(409);
    await expect(ownerQuery(h, T.id, 'delete from sampling_schedules where id = $1', [sid], F.id)).rejects.toThrow(/schedule_in_use/);
    const fresh = (await draw({ title: 'Redo this one' })).json().id;
    expect((await call(sF, 'DELETE', `/engagements/${eng}/sampling/${fresh}`)).statusCode).toBe(204);
    expect((await trail()).map((e) => e.sentence).join('\n')).toMatch(/discarded the untested sampling schedule "Redo this one"/);
  });

  test('the selection itself can never be changed, even by the database owner', async () => {
    await ownerQuery(h, T.id, 'update sampling_schedules set seed = $2 where id = $1', [sid, 'other'], F.id);
    expect((await detail(sid)).seed).toBe('results');
    await ownerQuery(h, T.id, "update sample_items set ref = 'HACKED', amount_cents = 1 where id = $1", [items[0]!.id], F.id);
    const it = (await detail(sid)).items[0];
    expect(it.ref).not.toBe('HACKED');
    expect(it.amount).not.toBe('0.01');
  });
});

describe('who can see schedules', () => {
  let sid: string;
  beforeAll(async () => {
    sid = (await draw({ title: 'Visibility check' })).json().id;
  });
  test('a partner not on the team can read but not record results; outsiders see nothing', async () => {
    expect((await call(sP2, 'GET', `/engagements/${eng}/sampling`)).json().schedules.length).toBeGreaterThan(0);
    expect((await call(sP2, 'GET', `/engagements/${eng}/sampling/${sid}`)).statusCode).toBe(200);
    const items = (await detail(sid)).items;
    expect((await call(sP2, 'PATCH', `/engagements/${eng}/sampling/${sid}/items/${items[0].id}`, { result: 'supported' })).statusCode).toBe(404);
    for (const s of [sOS, sM2]) {
      expect((await call(s, 'GET', `/engagements/${eng}/sampling`)).statusCode).toBe(404);
      expect((await call(s, 'GET', `/engagements/${eng}/sampling/${sid}`)).statusCode).toBe(404);
    }
  });
  test('opening a schedule is logged', async () => {
    expect((await trail()).map((e) => e.sentence).join('\n')).toMatch(/viewed the sampling schedule "Visibility check" for Mwangaza Traders Ltd/);
  });
  test('the list shows progress for each schedule', async () => {
    const l = (await call(sF, 'GET', `/engagements/${eng}/sampling`)).json().schedules as { title: string; progress: { selected: number; pending: number } }[];
    expect(l.find((s) => s.title === 'Visibility check')?.progress).toMatchObject({ selected: 10, pending: 10 });
  });
});
