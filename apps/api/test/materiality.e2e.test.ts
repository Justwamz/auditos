import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser;
let sM: Session, sF: Session;
let client: string;

const call = (s: Session, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const newEngagement = async (): Promise<string> => {
  const e = await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id });
  const id = e.json().id as string;
  await call(sM, 'POST', `/engagements/${id}/members`, { userId: F.id });
  return id;
};

const body = { benchmark: 'revenue', amount: '120000000.00', percent: 1, rationale: 'Revenue is the stable benchmark for a trading entity.' };

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'materiality');
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

describe('materiality', () => {
  test('a team member records materiality and gets the three amounts back; the paper keeps them', async () => {
    const e = await newEngagement();
    const r = await call(sF, 'PUT', `/engagements/${e}/materiality`, body);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ overall: '1200000.00', performance: '900000.00', trivial: '60000.00' });
    const list = (await call(sF, 'GET', `/engagements/${e}/items?kind=materiality`)).json().items as { id: string }[];
    expect(list).toHaveLength(1);
    const paper = (await call(sF, 'GET', `/items/${list[0]!.id}`)).json();
    expect(paper.content).toMatchObject({ benchmark: 'revenue', percent: 1, overall: '1200000.00', rationale: body.rationale });
  });

  test('saving again edits the same paper (a new version), it does not add a second one', async () => {
    const e = await newEngagement();
    await call(sF, 'PUT', `/engagements/${e}/materiality`, body);
    const again = await call(sF, 'PUT', `/engagements/${e}/materiality`, { ...body, percent: 2 });
    expect(again.json().overall).toBe('2400000.00');
    const list = (await call(sF, 'GET', `/engagements/${e}/items?kind=materiality`)).json().items as { id: string }[];
    expect(list).toHaveLength(1);
  });

  test('a short rationale is 400, an out-of-range percentage is 400', async () => {
    const e = await newEngagement();
    expect((await call(sF, 'PUT', `/engagements/${e}/materiality`, { ...body, rationale: 'short' })).statusCode).toBe(400);
    expect((await call(sF, 'PUT', `/engagements/${e}/materiality`, { ...body, percent: 50 })).statusCode).toBe(400);
    expect((await call(sF, 'PUT', `/engagements/${e}/materiality`, { ...body, amount: '-1' })).statusCode).toBe(400);
  });

  test('staff who are not on the engagement get 404', async () => {
    const e = await newEngagement();
    const outsider = await login(h, await makeUser(h, T.id, 'staff', 1));
    expect((await call(outsider, 'PUT', `/engagements/${e}/materiality`, body)).statusCode).toBe(404);
  });
});
