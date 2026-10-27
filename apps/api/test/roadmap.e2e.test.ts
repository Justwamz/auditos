import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser;
let sM: Session, sF: Session;
let client: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const newEngagement = async (): Promise<string> => {
  const e = await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id });
  const id = e.json().id as string;
  await call(sM, 'POST', `/engagements/${id}/members`, { userId: F.id });
  return id;
};
const roadmap = async (s: Session, e: string) => (await call(s, 'GET', `/engagements/${e}/roadmap`)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'roadmap');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  const sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  client = (await call(sM, 'POST', '/clients', { name: 'Trader Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('GET /engagements/:id/roadmap', () => {
  test('a new engagement starts at the first step with an instruction to start the checklists', async () => {
    const e = await newEngagement();
    const r = await roadmap(sF, e);
    expect(r.steps).toHaveLength(8);
    expect(r.next).toMatchObject({ id: 'loe', status: 'current', action: 'Start the checklists' });
    expect(r.percent).toBe(0);
  });

  test('generating checklists and answering the acceptance questions moves the roadmap on', async () => {
    const e = await newEngagement();
    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    const before = await roadmap(sF, e);
    expect(before.next.action).toMatch(/Answer the \d+ required question/);
    const rows = (await call(sF, 'GET', `/engagements/${e}/items?kind=checklist`)).json().items as { id: string; title: string }[];
    const acc = rows.find((r) => r.title === 'Client acceptance and continuance')!;
    const items = (await call(sF, 'GET', `/items/${acc.id}`)).json().content.items as { id: string; mandatory: boolean }[];
    for (const it of items) await call(sF, 'PATCH', `/checklists/${acc.id}/items/${it.id}`, { response: 'yes' });
    const after = await roadmap(sF, e);
    expect(after.next.id).toBe('loe');
    expect(after.next.action).toMatch(/engagement letter/i);
    await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'engagement_letter', title: 'Engagement letter', content: {} });
    const done = await roadmap(sF, e);
    expect(done.steps[0].status).toBe('done');
    expect(done.next.id).toBe('preplanning');
    expect(done.percent).toBeGreaterThan(0);
  });

  test('staff who are not on the engagement get 404', async () => {
    const e = await newEngagement();
    const outsider = await login(h, await makeUser(h, T.id, 'staff', 1));
    expect((await call(outsider, 'GET', `/engagements/${e}/roadmap`)).statusCode).toBe(404);
  });
});
