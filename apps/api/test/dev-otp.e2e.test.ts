import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TestTenant } from '@auditos/db/testing';
import { loadConfig } from '../src/config';
import { csrfOnly, harness, makeTenant, makeUser, PASSWORD, type Harness, type TestUser } from './helpers';

describe('development-only fixed one-time code', () => {
  let on: Harness;
  let off: Harness;
  let T: TestTenant;
  let user: TestUser;

  beforeAll(async () => {
    on = await harness({ env: { DEV_FIXED_OTP: '123456' } });
    off = await harness({ env: { DEV_FIXED_OTP: '' } });
    T = await makeTenant(on, 'devotp');
    user = await makeUser(on, T.id, 'staff', 1);
  });
  afterAll(async () => {
    await on.close();
    await off.close();
  });

  const signIn = async (h: Harness, code: string) => {
    const { csrf, cookie } = await csrfOnly(h);
    const headers = { 'x-csrf-token': csrf, cookie };
    const l = await h.app.inject({ method: 'POST', url: '/auth/login', headers, payload: { email: user.email, password: PASSWORD } });
    const v = await h.app.inject({ method: 'POST', url: '/auth/mfa/verify', headers, payload: { challengeId: l.json().challengeId, code } });
    return { v, csrf, session: v.cookies.find((c) => c.name === 'aos_session')?.value };
  };

  test('123456 signs in every time and also works for step-up straight away', async () => {
    for (let i = 0; i < 3; i++) expect((await signIn(on, '123456')).v.statusCode).toBe(200);
    const { csrf, session } = await signIn(on, '123456');
    const headers = { 'x-csrf-token': csrf, cookie: `aos_csrf=${csrf}; aos_session=${session}` };
    expect((await on.app.inject({ method: 'POST', url: '/auth/stepup', headers, payload: { code: '123456' } })).statusCode).toBe(200);
    expect((await on.app.inject({ method: 'GET', url: '/me', headers })).json().stepUpValid).toBe(true);
  });

  test('other wrong codes are still rejected and counted as failures', async () => {
    expect((await signIn(on, '654321')).v.statusCode).toBe(401);
  });

  test('without the setting, 123456 is not accepted', async () => {
    expect((await signIn(off, '123456')).v.statusCode).toBe(401);
  });
});

describe('the fixed code cannot be enabled outside development', () => {
  test('production refuses to start with it', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_FIXED_OTP: '123456' })).toThrow(/production/i);
  });
  test('a hosted demo may enable it only with the explicit DEMO_MODE flag', () => {
    expect(loadConfig({ NODE_ENV: 'production', DEV_FIXED_OTP: '123456', DEMO_MODE: 'true' }).devFixedOtp).toBe('123456');
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_FIXED_OTP: '123456', DEMO_MODE: 'yes' })).toThrow(/production/i);
  });
  test('it must be exactly six digits', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', DEV_FIXED_OTP: '12ab' })).toThrow(/six digits/i);
  });
  test('it is off by default and in tests', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).devFixedOtp).toBeUndefined();
    expect(loadConfig({ NODE_ENV: 'development', DEV_FIXED_OTP: '123456' }).devFixedOtp).toBe('123456');
  });
});
