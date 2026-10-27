import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { csrfOnly, harness, login, makeTenant, makeUser, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant;
let sStaff: Session, sManager: Session, sPartner: Session, sAdmin: Session, sPartnerAdmin: Session;

const get = (s: Session, url: string) => h.app.inject({ method: 'GET', url, headers: s.headers });
const ids = async (s: Session) => ((await get(s, '/help/articles')).json().groups as { articles: { id: string }[] }[]).flatMap((g) => g.articles.map((a) => a.id));

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'help');
  const users: TestUser[] = [];
  for (const [role, grade] of [['staff', 1], ['manager', 3], ['partner', 4], ['firm_admin', 0], ['partner', 4]] as const) users.push(await makeUser(h, T.id, role, grade));
  sStaff = await login(h, users[0]!);
  sManager = await login(h, users[1]!);
  sPartner = await login(h, users[2]!);
  sAdmin = await login(h, users[3]!);
  sPartnerAdmin = await login(h, users[4]!);
  // The last partner also holds the administrator permission.
  await ownerQuery(h, T.id, 'update memberships set is_admin = true where user_id = $1', [users[4]!.id]);
});
afterAll(async () => h.close());

describe('browsing the help', () => {
  test('each role sees its own guides', async () => {
    const staff = await ids(sStaff);
    const manager = await ids(sManager);
    const partner = await ids(sPartner);
    const admin = await ids(sAdmin);
    expect(staff).toContain('papers-prepare');
    expect(staff).not.toContain('review-sign-off');
    expect(manager).toContain('review-sign-off');
    expect(manager).not.toContain('papers-prepare');
    expect(partner).toContain('approve-issue-lock');
    expect(partner).not.toContain('people-and-access');
    expect(admin).toContain('people-and-access');
    expect(admin).not.toContain('review-sign-off');
    for (const list of [staff, manager, partner, admin]) expect(list).toContain('start-here');
  });

  test('the administrator permission adds the administration guides to any role', async () => {
    const ids2 = await ids(sPartnerAdmin);
    expect(ids2).toContain('people-and-access');
    expect(ids2).toContain('approve-issue-lock');
  });
});

describe('reading an article', () => {
  test('an allowed article returns its text', async () => {
    const r = await get(sManager, '/help/articles/review-sign-off');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: 'review-sign-off', title: expect.any(String) });
    expect(r.json().body).toContain('Manager review');
  });

  test('an article for another role answers exactly like one that does not exist', async () => {
    const hidden = await get(sStaff, '/help/articles/review-sign-off');
    const missing = await get(sStaff, '/help/articles/no-such-guide');
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(hidden.body).toBe(missing.body);
  });
});

describe('searching', () => {
  const search = async (s: Session, q: string, extra = '') => get(s, `/help/search?q=${encodeURIComponent(q)}${extra}`);

  test('finds the right guide, with a section, a snippet and a citation id', async () => {
    const r = await search(sManager, 'how do I sign off a paper');
    expect(r.statusCode).toBe(200);
    const [first] = r.json().results;
    expect(first).toMatchObject({ articleId: 'review-sign-off', title: expect.any(String), section: expect.any(String), snippet: expect.any(String) });
    expect(first.text).toBeUndefined();
  });

  test('the same words never find a guide for another role', async () => {
    for (const q of ['approve issue lock the engagement', 'invite a named person administrator permission', 'sign off reviewed manager partner']) {
      const staff = (await search(sStaff, q, '&limit=20')).json().results as { articleId: string }[];
      for (const hit of staff) expect(['approve-issue-lock', 'people-and-access', 'review-sign-off', 'engagement-stages']).not.toContain(hit.articleId);
    }
    const partner = (await search(sPartner, 'issue the report and lock')).json().results as { articleId: string }[];
    expect(partner[0]!.articleId).toBe('approve-issue-lock');
  });

  test('full=1 returns the passage text for a retrieval program, still only from visible guides', async () => {
    const r = (await search(sStaff, 'upload a receipt as evidence', '&full=1')).json().results as { articleId: string; text: string }[];
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.text.length).toBeGreaterThan(20);
    expect(r.map((x) => x.articleId)).not.toContain('people-and-access');
  });

  test('bad queries are rejected, not run', async () => {
    expect((await get(sStaff, '/help/search')).statusCode).toBe(400);
    expect((await search(sStaff, 'a')).statusCode).toBe(400);
    expect((await search(sStaff, 'x'.repeat(201))).statusCode).toBe(400);
    expect((await search(sStaff, 'paper', '&limit=500')).statusCode).toBe(400);
  });
});

describe('help on the page you are on', () => {
  test('returns the guides for a page, for this role only', async () => {
    const manager = (await get(sManager, '/help/topics/engagement.stage')).json().articles as { id: string }[];
    expect(manager.map((a) => a.id)).toContain('engagement-stages');
    expect((await get(sStaff, '/help/topics/engagement.stage')).json().articles).toEqual([]);
    expect((await get(sStaff, '/help/topics/engagement.checklists')).json().articles.length).toBeGreaterThan(0);
    expect((await get(sStaff, '/help/topics/Bad Topic!')).statusCode).toBe(404);
  });
});

describe('access', () => {
  test('the help needs a signed-in person', async () => {
    const { cookie } = await csrfOnly(h);
    const r = await h.app.inject({ method: 'GET', url: '/help/search?q=paper', headers: { cookie } });
    expect(r.statusCode).toBe(401);
  });
});
