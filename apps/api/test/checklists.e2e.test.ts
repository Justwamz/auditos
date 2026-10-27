import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { trading } from '../../../packages/fs-engine/test/fixtures';
import { csvOf, harness, importTb, login, makeTenant, makeUser, stepUp, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let P: TestUser, M: TestUser, F: TestUser, S: TestUser;
let sP: Session, sM: Session, sF: Session, sS: Session;
let tradingClient: string;
let farmingClient: string;

const call = (s: Session, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const newEngagement = async (client: string, riskFlags: string[] = []): Promise<string> => {
  const e = await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2026-01-01', periodEnd: '2026-12-31', partnerId: P.id, riskFlags });
  const id = e.json().id as string;
  for (const u of [F, S]) expect((await call(sM, 'POST', `/engagements/${id}/members`, { userId: u.id })).statusCode).toBe(201);
  return id;
};

const signoff = async (s: Session, u: TestUser, itemId: string, level: 'prepared' | 'manager' | 'partner') => {
  const hash = (await call(s, 'GET', `/items/${itemId}`)).json().contentHash;
  await stepUp(h, s, u);
  return call(s, 'POST', `/items/${itemId}/signoff`, { level, expectedHash: hash });
};

const approveFully = async (engagementId: string, kind: string) => {
  const it = (await call(sF, 'POST', `/engagements/${engagementId}/items`, { kind, title: kind, content: {} })).json();
  expect((await signoff(sF, F, it.id, 'prepared')).statusCode).toBe(200);
  expect((await signoff(sM, M, it.id, 'manager')).statusCode).toBe(200);
  expect((await signoff(sP, P, it.id, 'partner')).statusCode).toBe(200);
  return it.id as string;
};

const toFieldwork = async (e: string) => {
  await approveFully(e, 'acceptance');
  await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'engagement_letter', title: 'letter', content: {} });
  expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'planning' })).statusCode).toBe(200);
  await approveFully(e, 'materiality');
  await approveFully(e, 'risk_assessment');
  expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'fieldwork' })).statusCode).toBe(200);
};

const checklists = async (e: string) => (await call(sF, 'GET', `/engagements/${e}/items?kind=checklist`)).json().items as { id: string }[];
const checklist = async (id: string) => (await call(sF, 'GET', `/items/${id}`)).json();

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'checklists');
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  S = await makeUser(h, T.id, 'senior', 2);
  sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  sS = await login(h, S);
  for (const s of [sP, sM, sF, sS]) await call(s, 'POST', '/independence', { statement: 'No relationships that impair independence.' });
  tradingClient = (await call(sM, 'POST', '/clients', { name: 'Trader Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
  farmingClient = (await call(sM, 'POST', '/clients', { name: 'Farm Ltd', sector: 'farming', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
});
afterAll(async () => h.close());

describe('generation', () => {
  test('generates sector checklists with pinned template versions and is idempotent', async () => {
    const e = await newEngagement(tradingClient, ['fraud']);
    const first = await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    expect(first.statusCode).toBe(201);
    expect(first.json().created).toBeGreaterThanOrEqual(5);
    const list = await checklists(e);
    const c = await checklist(list[0]!.id);
    expect(c.content).toMatchObject({ templateVersion: 1 });
    expect(typeof c.content.templateId).toBe('string');
    expect(c.content.items.every((i: { response: unknown }) => i.response === null)).toBe(true);
    const all = (await Promise.all(list.map((l) => checklist(l.id)))).flatMap((x) => x.content.items as { question: string }[]);
    expect(all.some((i) => /inventory count/i.test(i.question))).toBe(true);
    const second = await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    expect(second.json()).toMatchObject({ created: 0, skipped: first.json().created });
  });

  test('a farming client gets core checklists and a sector-pack-not-available notice', async () => {
    const e = await newEngagement(farmingClient);
    const res = await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    expect(res.json().notices.join(' ')).toMatch(/sector pack not available/i);
    expect(res.json().created).toBeGreaterThanOrEqual(4);
  });

  test('a non-member cannot generate checklists', async () => {
    const e = await newEngagement(tradingClient);
    const outsider = await makeUser(h, T.id, 'senior', 2);
    const so = await login(h, outsider);
    expect((await call(so, 'POST', `/engagements/${e}/checklists/generate`)).statusCode).toBe(404);
  });
});

describe('answering', () => {
  let e: string;
  let cl: string;
  let items: { id: string; mandatory: boolean }[];

  beforeAll(async () => {
    e = await newEngagement(tradingClient);
    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    cl = (await checklists(e))[0]!.id;
    items = (await checklist(cl)).content.items;
  });

  test("'no' or 'na' without a rationale is 400; with one it is stored", async () => {
    const id = items[0]!.id;
    expect((await call(sF, 'PATCH', `/checklists/${cl}/items/${id}`, { response: 'na' })).statusCode).toBe(400);
    expect((await call(sF, 'PATCH', `/checklists/${cl}/items/${id}`, { response: 'no', rationale: '  ' })).statusCode).toBe(400);
    const ok = await call(sF, 'PATCH', `/checklists/${cl}/items/${id}`, { response: 'na', rationale: 'Entity has no such transactions' });
    expect(ok.statusCode).toBe(200);
    const stored = (await checklist(cl)).content.items.find((i: { id: string }) => i.id === id);
    expect(stored).toMatchObject({ response: 'na', rationale: 'Entity has no such transactions' });
  });

  test('an unknown item id is 404 and an invalid response is 400', async () => {
    expect((await call(sF, 'PATCH', `/checklists/${cl}/items/nope`, { response: 'yes' })).statusCode).toBe(404);
    expect((await call(sF, 'PATCH', `/checklists/${cl}/items/${items[1]!.id}`, { response: 'maybe' })).statusCode).toBe(400);
  });

  test('completeness lists mandatory unanswered items and a percentage', async () => {
    const before = (await call(sF, 'GET', `/engagements/${e}/completeness`)).json();
    expect(before.mandatoryOpen.length).toBeGreaterThan(0);
    const target = items.find((i) => i.mandatory && i.id !== items[0]!.id)!;
    await call(sF, 'PATCH', `/checklists/${cl}/items/${target.id}`, { response: 'yes' });
    const after = (await call(sF, 'GET', `/engagements/${e}/completeness`)).json();
    expect(after.mandatoryOpen.length).toBe(before.mandatoryOpen.length - 1);
    expect(after.percent).toBeGreaterThan(before.percent);
    expect(after.mandatoryOpen.some((o: { itemId: string }) => o.itemId === target.id)).toBe(false);
  });

  test('evidence links must point at evidence in the same engagement', async () => {
    const paper = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'not evidence', content: {} })).json();
    const res = await call(sF, 'PATCH', `/checklists/${cl}/items/${items[2]!.id}`, { response: 'yes', evidenceIds: [paper.id] });
    expect(res.statusCode).toBe(422);
  });

  test('answering a manager-reviewed checklist reverts the review', async () => {
    const e2 = await newEngagement(tradingClient);
    await call(sF, 'POST', `/engagements/${e2}/checklists/generate`);
    const id = (await checklists(e2))[0]!.id;
    await signoff(sF, F, id, 'prepared');
    await signoff(sM, M, id, 'manager');
    const first = (await checklist(id)).content.items[0].id;
    const res = await call(sF, 'PATCH', `/checklists/${id}/items/${first}`, { response: 'yes' });
    expect(res.json().state).toBe('prepared');
  });

  test('two people answering different items at once both persist', async () => {
    const e3 = await newEngagement(tradingClient);
    await call(sF, 'POST', `/engagements/${e3}/checklists/generate`);
    const id = (await checklists(e3))[0]!.id;
    const its = (await checklist(id)).content.items as { id: string }[];
    const [r1, r2] = await Promise.all([
      call(sF, 'PATCH', `/checklists/${id}/items/${its[0]!.id}`, { response: 'yes' }),
      call(sS, 'PATCH', `/checklists/${id}/items/${its[1]!.id}`, { response: 'yes' }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const stored = (await checklist(id)).content.items as { id: string; response: string | null }[];
    expect(stored.find((i) => i.id === its[0]!.id)?.response).toBe('yes');
    expect(stored.find((i) => i.id === its[1]!.id)?.response).toBe('yes');
  });
});

describe('review notes', () => {
  let e: string;
  let paper: string;

  beforeAll(async () => {
    e = await newEngagement(tradingClient);
    paper = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'Bank reconciliation', content: { a: 1 } })).json().id;
    await signoff(sF, F, paper, 'prepared');
    await signoff(sM, M, paper, 'manager');
  });

  test('only reviewers can raise notes', async () => {
    expect((await call(sS, 'POST', `/items/${paper}/review-notes`, { text: 'Please explain the reconciling item' })).statusCode).toBe(403);
  });

  test('an open note blocks partner sign-off; clearing it unblocks it', async () => {
    const raised = await call(sM, 'POST', `/items/${paper}/review-notes`, { text: 'Please explain the reconciling item of 12,000' });
    expect(raised.statusCode).toBe(201);
    const blocked = await signoff(sP, P, paper, 'partner');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('open_review_notes');

    expect((await call(sF, 'POST', `/review-notes/${raised.json().id}/clear`, { response: 'Explained' })).statusCode).toBe(403);
    expect((await call(sM, 'POST', `/review-notes/${raised.json().id}/clear`, { response: 'Explanation received and filed' })).statusCode).toBe(200);
    expect((await signoff(sP, P, paper, 'partner')).statusCode).toBe(200);
    const notes = (await call(sP, 'GET', `/items/${paper}/review-notes`)).json().notes;
    expect(notes[0]).toMatchObject({ status: 'cleared', response: 'Explanation received and filed' });
  });

  test('a reviewer cannot clear a note on an item they last edited, but can accept via another reviewer', async () => {
    const own = (await call(sM, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'Manager prepared', content: {} })).json().id;
    const note = await call(sP, 'POST', `/items/${own}/review-notes`, { text: 'Support missing for this balance' });
    expect((await call(sM, 'POST', `/review-notes/${note.json().id}/clear`, { response: 'fixed' })).statusCode).toBe(403);
    expect((await call(sM, 'POST', `/review-notes/${note.json().id}/accept`, { justification: 'Immaterial amount' })).statusCode).toBe(403);
    expect((await call(sP, 'POST', `/review-notes/${note.json().id}/accept`, { justification: 'Immaterial amount, accepted by partner' })).statusCode).toBe(200);
    const notes = (await call(sP, 'GET', `/items/${own}/review-notes`)).json().notes;
    expect(notes[0].status).toBe('accepted');
  });

  test('a cleared note cannot be cleared twice', async () => {
    const it = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'Another', content: {} })).json().id;
    const n = (await call(sM, 'POST', `/items/${it}/review-notes`, { text: 'Please add a reference' })).json().id;
    expect((await call(sM, 'POST', `/review-notes/${n}/clear`, { response: 'Reference added' })).statusCode).toBe(200);
    expect((await call(sM, 'POST', `/review-notes/${n}/clear`, { response: 'again' })).statusCode).toBe(409);
  });
});

describe('fieldwork to completion gate', () => {
  test('is blocked by open mandatory items and open review notes, and passes once resolved', async () => {
    const e = await newEngagement(tradingClient);
    await toFieldwork(e);

    const none = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'completion' });
    expect(none.statusCode).toBe(409);
    expect(none.json().blockers.map((b: { gate: string }) => b.gate)).toContain('mandatoryChecklistComplete');

    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    const open = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'completion' });
    expect(open.json().blockers.map((b: { gate: string }) => b.gate)).toContain('mandatoryChecklistComplete');

    for (const c of await checklists(e)) {
      const content = (await checklist(c.id)).content;
      for (const it of content.items as { id: string }[]) {
        const r = await call(sF, 'PATCH', `/checklists/${c.id}/items/${it.id}`, { response: 'yes' });
        expect(r.statusCode).toBe(200);
      }
    }
    expect((await call(sF, 'GET', `/engagements/${e}/completeness`)).json().mandatoryOpen).toEqual([]);
    expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'completion' })).json().blockers.map((b: { gate: string }) => b.gate)).toEqual(['trialBalanceMappedAndBalanced']);
    expect((await importTb(h, sF, e, 'tb.csv', Buffer.from(csvOf(trading.tb)))).statusCode).toBe(200);
    expect((await call(sF, 'PUT', `/engagements/${e}/mapping`, { mapping: trading.mapping })).statusCode).toBe(200);

    const paper = (await call(sF, 'POST', `/engagements/${e}/items`, { kind: 'workpaper', title: 'WP', content: {} })).json().id;
    const note = (await call(sM, 'POST', `/items/${paper}/review-notes`, { text: 'Open point on this paper' })).json().id;
    const withNote = await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'completion' });
    expect(withNote.json().blockers.map((b: { gate: string }) => b.gate)).toEqual(['reviewNotesCleared']);

    await call(sM, 'POST', `/review-notes/${note}/clear`, { response: 'Dealt with' });
    expect((await call(sM, 'POST', `/engagements/${e}/transition`, { to: 'completion' })).statusCode).toBe(200);
  }, 120_000);
});

describe('carry-forward of last year\'s answers', () => {
  let client: string;
  let first: string;

  const mine = async (e: string, _templateId: string) => {
    // Titles come from the list, so only one checklist is fetched in full (the rate limit is per minute).
    const row = ((await call(sF, 'GET', `/engagements/${e}/items?kind=checklist`)).json().items as { id: string; title: string }[]).find((r) => r.title === 'Client acceptance and continuance')!;
    return (await checklist(row.id)) as { id: string; content: { items: { id: string; response: string | null; rationale: string; prior: { response: string; rationale: string } | null }[] } };
  };
  const answer = (id: string, itemId: string, payload: object) => call(sF, 'PATCH', `/checklists/${id}/items/${itemId}`, payload);

  beforeAll(async () => {
    client = (await call(sM, 'POST', '/clients', { name: 'Returning Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json().id;
    const e = await call(sM, 'POST', '/engagements', { clientId: client, periodStart: '2025-01-01', periodEnd: '2025-12-31', partnerId: P.id });
    first = e.json().id as string;
    for (const u of [F, S]) await call(sM, 'POST', `/engagements/${first}/members`, { userId: u.id });
    await call(sF, 'POST', `/engagements/${first}/checklists/generate`);
    const c = await mine(first, 'acceptance');
    expect((await answer(c.id, c.content.items[0]!.id, { response: 'yes' })).statusCode).toBe(200);
    expect((await answer(c.id, c.content.items[1]!.id, { response: 'no', rationale: 'Owner changed during the year.' })).statusCode).toBe(200);
  });

  test("the next year's checklist shows last year's answers as suggestions only, and they do not count as answered", async () => {
    const e = await newEngagement(client);
    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    const c = await mine(e, 'acceptance');
    expect(c.content.items[0]).toMatchObject({ response: null, prior: { response: 'yes' } });
    expect(c.content.items[1]).toMatchObject({ response: null, prior: { response: 'no', rationale: 'Owner changed during the year.' } });
    expect(c.content.items[2]!.prior).toBeNull();
    const done = (await call(sF, 'GET', `/engagements/${e}/completeness`)).json();
    expect(done.answered).toBe(0);
  });

  test('confirming last year\'s answer records it as this year\'s answer, with the same rules as any answer', async () => {
    const e = await newEngagement(client);
    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    const c = await mine(e, 'acceptance');
    const ok = await call(sF, 'POST', `/checklists/${c.id}/items/${c.content.items[1]!.id}/confirm-prior`, {});
    expect(ok.statusCode).toBe(200);
    const after = await mine(e, 'acceptance');
    expect(after.content.items[1]).toMatchObject({ response: 'no', rationale: 'Owner changed during the year.' });
    expect((await call(sF, 'POST', `/checklists/${c.id}/items/${c.content.items[2]!.id}/confirm-prior`, {})).statusCode).toBe(409);
  });

  test('a client with no earlier engagement has no suggestions', async () => {
    const e = await newEngagement(tradingClient);
    await call(sF, 'POST', `/engagements/${e}/checklists/generate`);
    const c = await mine(e, 'acceptance');
    expect(c.content.items.every((i) => i.prior === null)).toBe(true);
  });
});
