import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import type { TestTenant } from '@auditos/db/testing';
import { clearKept, keepIcon, keptSize, MAX_KEPT_BYTES, setDrawer } from '../src/branding/icon';
import { harness, login, makeTenant, makeUser, multipartBody, ownerQuery, type Harness, type Session, type TestUser } from './helpers';

let h: Harness;
let T: TestTenant, T2: TestTenant;
let A: TestUser, B: TestUser, F: TestUser;
let sA: Session, sB: Session, sF: Session;

const SIZES = { '32': 32, '180': 180, '192': 192, '512': 512, maskable: 512 } as const;
const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const WHITE = [255, 255, 255, 255];

const get = (s: Session | null, url: string) => h.app.inject({ method: 'GET', url, ...(s ? { headers: s.headers } : {}) });
const picture = (width: number, height: number, background: { r: number; g: number; b: number; alpha: number }) => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const red = { r: 220, g: 30, b: 30, alpha: 1 };
const upload = async (s: Session, data: Buffer): Promise<string> => {
  const m = multipartBody('logo.png', data);
  const r = await h.app.inject({ method: 'POST', url: '/branding/logo', headers: { ...s.headers, 'content-type': m.contentType }, payload: m.payload });
  expect(r.statusCode).toBe(200);
  return r.json().logoId as string;
};
const raw = async (b: Buffer) => {
  const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { info, at: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)) };
};
/** Puts bytes straight into the table, the way a damaged or tampered row would look (the upload checks are skipped). */
const plant = async (tenantId: string, type: string, bytes: Buffer, w: number, hgt: number): Promise<string> =>
  (await ownerQuery(h, tenantId, 'insert into firm_logos (tenant_id, content_type, bytes, width, height) values ($1, $2, $3, $4, $5) returning id', [tenantId, type, bytes, w, hgt], A.id)).rows[0].id as string;

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
const jpgJunk = (): Buffer => {
  const sof = Buffer.alloc(15);
  sof.writeUInt16BE(17, 0);
  sof[2] = 8;
  sof.writeUInt16BE(20, 3);
  sof.writeUInt16BE(20, 5);
  sof[7] = 3;
  return Buffer.concat([Buffer.from('ffd8ffe000040000ffc0', 'hex'), sof, Buffer.alloc(20, 3)]);
};
const rgbaBadData = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', Buffer.from('truncated')), chunk('IEND', Buffer.alloc(0))]);
};
/** A header that claims far more than the allowed side: refused before any decoding. */
/** Passes the upload checks (header, size, data length) but its chunk checksums are blank, which the picture library refuses. */
const badChecksums = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(8 * (1 + 3 * 8)))), chunk('IEND', Buffer.alloc(0))]);
};
const hugeClaim = (): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(60000, 0);
  ihdr.writeUInt32BE(60000, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0))]);
};

let logoA: string;

beforeAll(async () => {
  h = await harness();
  T = await makeTenant(h, 'icon-a');
  T2 = await makeTenant(h, 'icon-b');
  A = await makeUser(h, T.id, 'firm_admin', 0);
  F = await makeUser(h, T.id, 'staff', 1);
  B = await makeUser(h, T2.id, 'firm_admin', 0);
  sA = await login(h, A);
  sF = await login(h, F);
  sB = await login(h, B);
  logoA = await upload(sA, await picture(300, 100, red));
});
afterAll(async () => h.close());

describe('the square icon', () => {
  for (const [variant, size] of Object.entries(SIZES)) {
    test(`variant ${variant} is a ${size} by ${size} PNG with the right headers`, async () => {
      const r = await get(sF, `/branding/icon/${logoA}/${variant}`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/png');
      expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.rawPayload.subarray(0, 8).equals(PNG_SIG)).toBe(true);
      const m = await sharp(r.rawPayload).metadata();
      expect([m.width, m.height]).toEqual([size, size]);
    });
  }

  test('512: white corner, logo colour in the centre', async () => {
    const px = await raw((await get(sA, `/branding/icon/${logoA}/512`)).rawPayload);
    expect(px.at(2, 2)).toEqual(WHITE);
    const c = px.at(256, 256);
    expect(c[0]).toBeGreaterThan(200);
    expect(c[1]).toBeLessThan(60);
    expect(c[3]).toBe(255);
  });

  test('the maskable icon leaves more blank edge than the plain one', async () => {
    const id = await upload(sA, await picture(100, 100, red));
    const edge = async (variant: string) => {
      const px = await raw((await get(sA, `/branding/icon/${id}/${variant}`)).rawPayload);
      for (let x = 0; x < 512; x++) if (px.at(x, 256)[1]! < 128) return x;
      return -1;
    };
    const plain = await edge('512');
    const mask = await edge('maskable');
    expect(Math.abs(plain - Math.round(512 * 0.12))).toBeLessThanOrEqual(2);
    expect(Math.abs(mask - Math.round(512 * 0.22))).toBeLessThanOrEqual(2);
  });

  test('a 2000x20 strip is not stretched: square, white corners, thin in the middle', async () => {
    const id = await upload(sA, await picture(2000, 20, red));
    const r = await get(sA, `/branding/icon/${id}/512`);
    expect(r.statusCode).toBe(200);
    const px = await raw(r.rawPayload);
    expect([px.info.width, px.info.height]).toEqual([512, 512]);
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [256, 100], [256, 400]] as const) expect(px.at(x, y)).toEqual(WHITE);
    expect(px.at(256, 256)[1]).toBeLessThan(80);
    expect(px.at(70, 256)[1]).toBeLessThan(80);
  });

  test('a 20x2000 bar is not stretched: square, white corners, thin in the middle', async () => {
    const id = await upload(sA, await picture(20, 2000, red));
    const r = await get(sA, `/branding/icon/${id}/512`);
    expect(r.statusCode).toBe(200);
    const px = await raw(r.rawPayload);
    expect([px.info.width, px.info.height]).toEqual([512, 512]);
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [100, 256], [400, 256]] as const) expect(px.at(x, y)).toEqual(WHITE);
    expect(px.at(256, 256)[1]).toBeLessThan(80);
    expect(px.at(256, 70)[1]).toBeLessThan(80);
  });

  test('a transparent logo sits on white, not black', async () => {
    const id = await upload(sA, await picture(120, 60, { r: 0, g: 0, b: 0, alpha: 0 }));
    const px = await raw((await get(sA, `/branding/icon/${id}/192`)).rawPayload);
    for (const [x, y] of [[0, 0], [191, 0], [0, 191], [191, 191], [96, 96]] as const) expect(px.at(x, y)).toEqual(WHITE);
  });

  test('a second request gives the same bytes', async () => {
    const a = (await get(sA, `/branding/icon/${logoA}/180`)).rawPayload;
    const b = (await get(sF, `/branding/icon/${logoA}/180`)).rawPayload;
    expect(a.equals(b)).toBe(true);
  });
});

describe('falling back', () => {
  test('a JPEG that passes the upload check but has a junk body goes to the AuditOS icon', async () => {
    const id = await plant(T.id, 'image/jpeg', jpgJunk(), 20, 20);
    const r = await get(sA, `/branding/icon/${id}/192`);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/icons/auditos-192.png');
    expect(r.headers['cache-control']).toBe('private, no-store');
  });

  test('a transparent PNG whose data cannot be unpacked fails the upload check and goes to the AuditOS icon', async () => {
    const id = await plant(T.id, 'image/png', rgbaBadData(), 2, 2);
    const r = await get(sA, `/branding/icon/${id}/maskable`);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/icons/auditos-maskable.png');
  });

  test('a picture that claims a huge size is never opened', async () => {
    const id = await plant(T.id, 'image/png', hugeClaim(), 100, 100);
    const r = await get(sA, `/branding/icon/${id}/32`);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/icons/auditos-32.png');
  });

  test('text pretending to be a picture goes to the AuditOS icon', async () => {
    const id = await plant(T.id, 'image/png', Buffer.concat([PNG_SIG, Buffer.from('<svg onload=alert(1)>')]), 1, 1);
    const r = await get(sA, `/branding/icon/${id}/180`);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/icons/auditos-180.png');
  });
});

describe('who may ask', () => {
  test("another firm's logo id is not found, before and after the icon was made", async () => {
    expect((await get(sB, `/branding/icon/${logoA}/512`)).statusCode).toBe(404);
    expect((await get(sA, `/branding/icon/${logoA}/512`)).statusCode).toBe(200);
    expect((await get(sB, `/branding/icon/${logoA}/512`)).statusCode).toBe(404);
    expect((await get(sB, `/branding/icon/${logoA}/32`)).statusCode).toBe(404);
  });
  test('unknown variant, odd id and unknown id are not found', async () => {
    expect((await get(sA, `/branding/icon/${logoA}/64`)).statusCode).toBe(404);
    expect((await get(sA, `/branding/icon/${logoA}/__proto__`)).statusCode).toBe(404);
    expect((await get(sA, `/branding/icon/not-a-uuid/512`)).statusCode).toBe(404);
    expect((await get(sA, `/branding/icon/00000000-0000-4000-8000-000000000000/512`)).statusCode).toBe(404);
  });
  test('signed out gets no picture', async () => {
    const r = await get(null, `/branding/icon/${logoA}/512`);
    expect(r.statusCode).toBe(401);
    expect(String(r.headers['content-type'])).not.toContain('image/png');
  });
});

describe('failures, sharing and limits', () => {
  const ok = async () => (await upload(sA, await picture(60, 30, red)));
  const calls: string[] = [];
  beforeEach(() => {
    clearKept();
    calls.length = 0;
  });
  afterEach(() => setDrawer(null));

  test('a picture that passes the upload check but is refused by the picture library goes to the AuditOS icon', async () => {
    const bad = badChecksums();
    await expect(sharp(bad, { failOn: 'error' }).png().toBuffer()).rejects.toThrow();
    const id = await plant(T.id, 'image/png', bad, 8, 8);
    const r = await get(sA, `/branding/icon/${id}/192`);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/icons/auditos-192.png');
  });

  test('a drawing failure is tried again on the next request', async () => {
    const id = await ok();
    let n = 0;
    setDrawer(async () => {
      if (n++ === 0) throw new Error('slow disk');
      return picture(4, 4, red);
    });
    expect((await get(sA, `/branding/icon/${id}/32`)).statusCode).toBe(302);
    expect((await get(sA, `/branding/icon/${id}/32`)).statusCode).toBe(200);
    expect(n).toBe(2);
  });

  test('a file that fails the upload check is remembered as unusable and never drawn', async () => {
    const id = await plant(T.id, 'image/png', Buffer.concat([PNG_SIG, Buffer.from('nothing')]), 1, 1);
    setDrawer(async () => {
      calls.push('draw');
      return picture(4, 4, red);
    });
    expect((await get(sA, `/branding/icon/${id}/32`)).statusCode).toBe(302);
    expect((await get(sA, `/branding/icon/${id}/32`)).statusCode).toBe(302);
    expect(calls).toEqual([]);
    expect(keptSize().entries).toBe(1);
  });

  test('the kept icons stay within a total size', () => {
    const chunkSize = 6 * 1024 * 1024;
    for (let i = 0; i < 8; i++) keepIcon(`k${i}`, Buffer.alloc(chunkSize));
    const s = keptSize();
    expect(s.bytes).toBeLessThanOrEqual(MAX_KEPT_BYTES);
    expect(s.entries).toBe(4);
  });

  test('at the same time, the same icon is drawn once', async () => {
    const id = await ok();
    setDrawer(async () => {
      calls.push('draw');
      await new Promise((r) => setTimeout(r, 100));
      return picture(4, 4, red);
    });
    const rs = await Promise.all(Array.from({ length: 8 }, () => get(sA, `/branding/icon/${id}/180`)));
    expect(rs.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    expect(calls.length).toBe(1);
  });

  test('a burst of different icons never draws more than two at once', async () => {
    const ids = [await ok(), await ok(), await ok()];
    let now = 0;
    let most = 0;
    setDrawer(async () => {
      now++;
      most = Math.max(most, now);
      await new Promise((r) => setTimeout(r, 80));
      now--;
      return picture(4, 4, red);
    });
    const variants = ['32', '180', '192'];
    const rs = await Promise.all(ids.flatMap((id) => variants.map((v) => get(sA, `/branding/icon/${id}/${v}`))));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(most).toBe(2);
  });
});
