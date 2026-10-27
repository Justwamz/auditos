import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, type Harness, type Session, type TestUser } from './helpers';
import { isGenericMailbox, isPersonName } from '../src/people/names';

let h: Harness;
let T: TestTenant;
let admin: TestUser;
let sAdmin: Session;

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_TOKEN ??= 'test-platform-token';
  h = await harness();
  T = await makeTenant(h, 'named');
  admin = await makeUser(h, T.id, 'firm_admin', 0);
  sAdmin = await login(h, admin);
});
afterAll(async () => h.close());

const call = (s: Session, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });
const invite = (body: object) => call(sAdmin, 'POST', '/admin/users', body);

describe('names and mailboxes', () => {
  test.each(['admin', 'info', 'accounts', 'office', 'support', 'finance', 'hr', 'audit', 'noreply', 'no-reply', 'team', 'sales', 'Admin', 'admin.office', 'firm-admin'])(
    '%s@ is a generic mailbox',
    (local) => expect(isGenericMailbox(`${local}@kangethe.example.test`)).toBe(true),
  );
  test.each(['grace.kangethe', 'g.wanjiku', 'peter', 'administrator.lee'])('%s@ is a person', (local) => expect(isGenericMailbox(`${local}@kangethe.example.test`)).toBe(false));
  test.each([['Grace Kangethe', true], ['Wanjiku', false], ['A B', false], ['  ', false], ['Grace 123', false], ['Mary-Ann O\'Neil', true]] as const)(
    'person name %j is %s',
    (name, ok) => expect(isPersonName(name)).toBe(ok),
  );
});

describe('inviting named people', () => {
  test('a full name is required, and a generic mailbox is refused', async () => {
    expect((await invite({ email: 'grace.k@kangethe.example.test', role: 'staff' })).statusCode).toBe(400);
    expect((await invite({ email: 'grace.k@kangethe.example.test', role: 'staff', fullName: 'G' })).statusCode).toBe(400);
    const generic = await invite({ email: 'accounts@kangethe.example.test', role: 'staff', fullName: 'Accounts Team' });
    expect(generic.statusCode).toBe(400);
    expect(JSON.stringify(generic.json().issues)).toContain('generic_mailbox');
  });

  test('an invited person is stored with their name and listed with it', async () => {
    const r = await invite({ email: 'grace.k@kangethe.example.test', role: 'staff', fullName: 'Grace Kangethe' });
    expect(r.statusCode).toBe(201);
    const users = (await call(sAdmin, 'GET', '/admin/users')).json().users as { email: string; fullName: string; isAdmin: boolean }[];
    expect(users.find((u) => u.email === 'grace.k@kangethe.example.test')).toMatchObject({ fullName: 'Grace Kangethe', isAdmin: false });
  });
});

describe('admin is a permission held by a named person', () => {
  test('a partner given the permission can administer; a plain partner cannot', async () => {
    const p = await makeUser(h, T.id, 'partner', 4);
    const sp = await login(h, p);
    expect((await call(sp, 'GET', '/admin/users')).statusCode).toBe(403);
    expect((await call(sAdmin, 'PATCH', `/admin/users/${p.id}`, { isAdmin: true })).statusCode).toBe(200);
    // The permission is read from the database on every request, so the same session gains it at once.
    expect((await call(sp, 'GET', '/admin/users')).statusCode).toBe(200);
    expect((await call(sp, 'GET', '/me')).json()).toMatchObject({ isAdmin: true, role: 'partner' });
    expect((await call(sAdmin, 'PATCH', `/admin/users/${p.id}`, { isAdmin: false })).statusCode).toBe(200);
    expect((await call(sp, 'GET', '/admin/users')).statusCode).toBe(403);
  });

  test('only an admin can grant the permission', async () => {
    const staff = await makeUser(h, T.id, 'staff', 1);
    const other = await makeUser(h, T.id, 'staff', 1);
    expect((await call(await login(h, staff), 'PATCH', `/admin/users/${other.id}`, { isAdmin: true })).statusCode).toBe(403);
  });

  test('an admin cannot deactivate themselves, so a firm is never left without one', async () => {
    const t2 = await makeTenant(h, 'lastadmin');
    const only = await makeUser(h, t2.id, 'firm_admin', 0);
    const partner = await makeUser(h, t2.id, 'partner', 4);
    const s = await login(h, only);
    expect((await call(s, 'PATCH', `/admin/users/${partner.id}`, { isAdmin: true })).statusCode).toBe(200);
    expect((await call(s, 'PATCH', `/admin/users/${only.id}`, { active: false })).statusCode).toBe(409);
  });
});

describe('creating a firm needs a named admin', () => {
  const post = (body: object) => h.app.inject({ method: 'POST', url: '/platform/tenants', headers: { 'x-platform-token': process.env.PLATFORM_ADMIN_TOKEN! }, payload: body });
  test('a name is required and a generic mailbox is refused', async () => {
    expect((await post({ name: 'Firm One', adminEmail: 'wanjiru@firmone.example.test' })).statusCode).toBe(400);
    expect((await post({ name: 'Firm One', adminEmail: 'admin@firmone.example.test', adminFullName: 'Wanjiru Kamau' })).statusCode).toBe(400);
    const ok = await post({ name: 'Firm One', adminEmail: 'wanjiru@firmone.example.test', adminFullName: 'Wanjiru Kamau' });
    expect(ok.statusCode).toBe(201);
  });
});

describe('people and /me carry names', () => {
  test('/people lists full names', async () => {
    const m = await makeUser(h, T.id, 'manager', 3);
    const res = await call(await login(h, m), 'GET', '/people');
    expect(res.json().people.every((p: { fullName: string | null }) => typeof p.fullName === 'string')).toBe(true);
  });
  test('/me returns the full name', async () => {
    expect((await call(sAdmin, 'GET', '/me')).json().fullName).toBeTruthy();
  });
});
