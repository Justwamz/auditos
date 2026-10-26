import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser;
let sP: Session, sM: Session, sF: Session;
let engId: string;

const call = (s: Session, method: 'GET' | 'POST', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'dash');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  for (const s of [sP, sM, sF]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  const c = (await call(sM, 'POST', '/clients', { name: 'Dash Client', sector: 'rental', legalForm: 'sole', yearEndMonth: 12 })).json().id;
  engId = (await call(sM, 'POST', '/engagements', { clientId: c, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id })).json().id;
  await call(sM, 'POST', `/engagements/${engId}/members`, { userId: F.id });
});
afterAll(async () => h.close());

const signoff = async (s: Session, u: TestUser, id: string, level: string) => {
  const hash = (await call(s, 'GET', `/items/${id}`)).json().contentHash;
  await stepUp(h, s, u);
  return call(s, 'POST', `/items/${id}/signoff`, { level, expectedHash: hash });
};

describe('dashboard', () => {
  test('shows the right review queue for each role and my drafts', async () => {
    const draft = (await call(sF, 'POST', `/engagements/${engId}/items`, { kind: 'checklist', title: 'Draft paper', content: {} })).json().id;
    const prepared = (await call(sF, 'POST', `/engagements/${engId}/items`, { kind: 'checklist', title: 'Prepared paper', content: {} })).json().id;
    await signoff(sF, F, prepared, 'prepared');
    const reviewed = (await call(sF, 'POST', `/engagements/${engId}/items`, { kind: 'checklist', title: 'Reviewed paper', content: {} })).json().id;
    await signoff(sF, F, reviewed, 'prepared');
    await signoff(sM, M, reviewed, 'manager');

    const staff = (await call(sF, 'GET', '/dashboard')).json();
    expect(staff.awaitingReview).toEqual([]);
    expect(staff.myDrafts.map((i: { id: string }) => i.id)).toEqual([draft]);

    const manager = (await call(sM, 'GET', '/dashboard')).json();
    expect(manager.awaitingReview.map((i: { id: string; level: string }) => [i.id, i.level])).toEqual([[prepared, 'manager']]);

    const partner = (await call(sP, 'GET', '/dashboard')).json();
    expect(partner.awaitingReview.map((i: { id: string; level: string }) => [i.id, i.level])).toEqual([[reviewed, 'partner']]);
    expect(partner.engagements[0]).toMatchObject({ id: engId, clientName: 'Dash Client' });
  });

  test('items the viewer last edited are never in their own review queue', async () => {
    const own = (await call(sM, 'POST', `/engagements/${engId}/items`, { kind: 'checklist', title: 'Manager prepared', content: {} })).json().id;
    await signoff(sM, M, own, 'prepared');
    const manager = (await call(sM, 'GET', '/dashboard')).json();
    expect(manager.awaitingReview.map((i: { id: string }) => i.id)).not.toContain(own);
  });

  test('counts open review notes across my engagements', async () => {
    const it = (await call(sF, 'POST', `/engagements/${engId}/items`, { kind: 'checklist', title: 'Needs review', content: {} })).json().id;
    await call(sM, 'POST', `/items/${it}/review-notes`, { text: 'Please add support' });
    expect((await call(sF, 'GET', '/dashboard')).json().openNotes).toBeGreaterThanOrEqual(1);
  });

  test('sign-offs in the item view carry the signer email', async () => {
    const it = (await call(sF, 'POST', `/engagements/${engId}/items`, { kind: 'checklist', title: 'Signer', content: {} })).json().id;
    await signoff(sF, F, it, 'prepared');
    const got = (await call(sF, 'GET', `/items/${it}`)).json();
    expect(got.signoffs[0].userEmail).toBe(F.email);
  });

  test('a firm admin without engagements gets an empty dashboard', async () => {
    const admin = await makeUser(h, T.id, 'firm_admin', 0);
    const sa = await login(h, admin);
    expect((await call(sa, 'GET', '/dashboard')).json()).toMatchObject({ engagements: [], awaitingReview: [], myDrafts: [], openNotes: 0 });
  });
});
