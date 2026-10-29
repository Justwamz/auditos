import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { harness, login, makeTenant, makeUser, multipartBody, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant, T2: TestTenant;
let A: TestUser, P: TestUser, M: TestUser, F: TestUser, B: TestUser;
let sA: Session, sP: Session, sM: Session, sF: Session, sB: Session;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const call = (s: Session, method: Method, url: string, payload?: object) =>
  h.app.inject({ method, url, headers: s.headers, ...(payload ? { payload } : {}) });

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
const png = (w: number, hgt: number, extra = 0): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(20 + extra, 7)), chunk('IEND', Buffer.alloc(0))]);
};
const jpg = (w: number, hgt: number): Buffer => {
  const sof = Buffer.alloc(15);
  sof.writeUInt16BE(17, 0);
  sof[2] = 8;
  sof.writeUInt16BE(hgt, 3);
  sof.writeUInt16BE(w, 5);
  sof[7] = 3;
  return Buffer.concat([Buffer.from('ffd8ffe000040000ffc0', 'hex'), sof, Buffer.alloc(20, 3)]);
};
const upload = (s: Session, name: string, data: Buffer) => {
  const m = multipartBody(name, data);
  return h.app.inject({ method: 'POST', url: '/branding/logo', headers: { ...s.headers, 'content-type': m.contentType }, payload: m.payload });
};
const body = (over: object = {}) => ({ primary: '#1f5f4a', secondary: '#e8c547', phone: '+254 700 000 000', email: 'info@firm.example.test', website: 'https://firm.example.test', footerNote: 'Thank you', ...over });

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'brand-api');
  T2 = await makeTenant(h, 'brand-api-b');
  A = await makeUser(h, T.id, 'firm_admin', 0);
  P = await makeUser(h, T.id, 'partner', 4);
  M = await makeUser(h, T.id, 'manager', 3);
  F = await makeUser(h, T.id, 'staff', 1);
  B = await makeUser(h, T2.id, 'firm_admin', 0);
  sA = await login(h, A);
  sP = await login(h, P);
  sM = await login(h, M);
  sF = await login(h, F);
  sB = await login(h, B);
});
afterAll(async () => h.close());

describe('reading before anything is saved', () => {
  test('/me has no branding and every member can read the branding page data', async () => {
    expect((await call(sA, 'GET', '/me')).json().branding).toBeNull();
    for (const s of [sA, sP, sM, sF]) expect((await call(s, 'GET', '/branding')).statusCode).toBe(200);
    expect((await call(sA, 'GET', '/branding')).json().canEdit).toBe(true);
    expect((await call(sF, 'GET', '/branding')).json().canEdit).toBe(false);
    expect((await call(sP, 'GET', '/branding')).json().canEdit).toBe(false);
  });
});

describe('administrator saves', () => {
  test('round-trips, and /me carries the palette for every member', async () => {
    const put = await call(sA, 'PUT', '/branding', body());
    expect(put.statusCode).toBe(200);
    const got = (await call(sM, 'GET', '/branding')).json();
    expect(got.branding).toMatchObject({ primary: '#1f5f4a', phone: '+254 700 000 000', email: 'info@firm.example.test', website: 'https://firm.example.test', footerNote: 'Thank you', logoId: null, adjustments: [] });
    expect(got.branding.firm).toHaveProperty('legalName');
    for (const s of [sA, sF]) {
      const me = (await call(s, 'GET', '/me')).json();
      expect(me.branding.palette['--ledger']).toBe('#1f5f4a');
      expect(me.branding.logoId).toBeNull();
      expect(typeof me.branding.name).toBe('string');
    }
  });
  test('a blank value clears a field, an omitted one is kept', async () => {
    await call(sA, 'PUT', '/branding', { primary: '#1f5f4a', secondary: '#e8c547', phone: '' });
    const b = (await call(sA, 'GET', '/branding')).json().branding;
    expect(b.phone).toBeNull();
    expect(b.email).toBe('info@firm.example.test');
  });
  test('a pale primary is saved darker and the response says so', async () => {
    const put = (await call(sA, 'PUT', '/branding', body({ primary: '#fde047' }))).json();
    expect(put.branding.primary).not.toBe('#fde047');
    expect(put.branding.adjustments.some((a: { field: string; reason: string }) => a.field === 'primary' && a.reason.length > 10)).toBe(true);
    const me = (await call(sF, 'GET', '/me')).json();
    expect(me.branding.palette['--ledger']).toBe(put.branding.primary);
    expect((await call(sA, 'GET', '/branding')).json().branding.primary).toBe(put.branding.primary);
    await call(sA, 'PUT', '/branding', body());
  });
  test('bad phone, email, website and colour codes are refused with plain words', async () => {
    for (const bad of [{ phone: 'call me' }, { email: 'nope' }, { website: 'ftp://x.test' }, { website: 'firm.test' }, { primary: 'green' }, { footerNote: 'x'.repeat(301) }]) {
      const r = await call(sA, 'PUT', '/branding', body(bad));
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
      expect(JSON.stringify(r.json())).not.toMatch(/hex|token|css|regex/i);
    }
  });
  test('the activity history has a plain sentence without raw colour values', async () => {
    const trail = (await call(sA, 'GET', '/audit-trail?kind=changes')).json();
    const sentences = (trail.events as { sentence: string }[]).map((e) => e.sentence);
    const s = sentences.find((x) => /branding/.test(x));
    expect(s).toBeTruthy();
    expect(s).not.toMatch(/#[0-9a-f]{6}/i);
    expect(s).not.toMatch(/made a change/);
  });
});

describe('who may change branding', () => {
  test('partner, manager and staff are refused on PUT, POST and DELETE', async () => {
    for (const s of [sP, sM, sF]) {
      expect((await call(s, 'PUT', '/branding', body())).statusCode).toBe(403);
      expect((await upload(s, 'logo.png', png(10, 10))).statusCode).toBe(403);
      expect((await call(s, 'DELETE', '/branding/logo')).statusCode).toBe(403);
    }
  });
});

describe('logo upload', () => {
  test('a small PNG and a small JPG are accepted, become current, and are served to every member', async () => {
    const p = await upload(sA, 'logo.png', png(120, 60));
    expect(p.statusCode).toBe(200);
    const id = p.json().logoId as string;
    expect((await call(sF, 'GET', '/me')).json().branding.logoId).toBe(id);
    const r = await call(sF, 'GET', `/branding/logo/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(r.rawPayload, png(120, 60))).toBe(0);

    const j = await upload(sA, 'logo.jpeg', jpg(300, 100));
    expect(j.statusCode).toBe(200);
    const jr = await call(sM, 'GET', `/branding/logo/${j.json().logoId}`);
    expect(jr.headers['content-type']).toBe('image/jpeg');
    expect((await call(sA, 'GET', '/branding')).json().branding.logoId).toBe(j.json().logoId);
  });
  test('another firm cannot read the logo, and an unknown id is 404', async () => {
    const id = (await call(sA, 'GET', '/branding')).json().branding.logoId as string;
    expect((await call(sB, 'GET', `/branding/logo/${id}`)).statusCode).toBe(404);
    expect((await call(sA, 'GET', '/branding/logo/not-an-id')).statusCode).toBe(404);
    expect((await call(sA, 'GET', '/branding/logo/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
  test('refused with plain messages', async () => {
    const cases: [string, Buffer, string][] = [
      ['x.png', Buffer.from('this is just text pretending to be a picture'), 'That file is not a PNG or JPG picture.'],
      ['x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'That file is not a PNG or JPG picture.'],
      ['x.gif', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]), 'That file is not a PNG or JPG picture.'],
      ['big.png', png(100, 100, 3 * 1024 * 1024), 'Logos can be at most 1 MB.'],
      ['wide.png', png(3000, 100), 'Logos can be at most 2000 pixels wide or tall.'],
      ['tall.jpg', jpg(100, 3000), 'Logos can be at most 2000 pixels wide or tall.'],
    ];
    for (const [name, data, reason] of cases) {
      const r = await upload(sA, name, data);
      expect(r.statusCode, name).toBe(422);
      expect(r.json().reason, name).toBe(reason);
    }
  });
  test('removing the logo clears only the current reference; the old version is still served', async () => {
    const id = (await call(sA, 'GET', '/branding')).json().branding.logoId as string;
    expect((await call(sA, 'DELETE', '/branding/logo')).statusCode).toBe(200);
    expect((await call(sA, 'GET', '/branding')).json().branding.logoId).toBeNull();
    expect((await call(sF, 'GET', `/branding/logo/${id}`)).statusCode).toBe(200);
  });
});

describe('the other firm', () => {
  test('sees nothing of this firm and has no branding of its own', async () => {
    expect((await call(sB, 'GET', '/me')).json().branding).toBeNull();
    expect((await call(sB, 'GET', '/branding')).json().branding.primary).toBe('#2e6b4c');
  });
});
