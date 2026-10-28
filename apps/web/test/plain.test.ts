import { describe, expect, test } from 'vitest';
import { ApiError } from '../lib/api';
import { findJargon } from '../lib/plain';
import { explain, MESSAGES } from '../lib/text';

describe('findJargon', () => {
  test('flags software words', () => {
    expect(findJargon('Enter the code from your authenticator app')).toEqual(['authenticator']);
  });
  test('plain sentences pass', () => {
    expect(findJargon('Enter the 6-digit code from your phone.')).toEqual([]);
  });
  test('ignores case and returns distinct lowercase words', () => {
    expect(findJargon('Session SESSION Simulated tenant').sort()).toEqual(['session', 'simulated', 'tenant']);
  });
  test('uses word boundaries for api, mfa and totp', () => {
    expect(findJargon('capital rapid')).toEqual([]);
    expect(findJargon('the API and MFA and TOTP').sort()).toEqual(['api', 'mfa', 'totp']);
  });
});

describe('shared messages', () => {
  test.each(Object.entries(MESSAGES))('%s has no software words', (_code, text) => {
    expect(findJargon(text)).toEqual([]);
  });
  test('unknown code fallback is plain and has a reference', () => {
    const msg = explain(new ApiError(500, 'weird_code', {}));
    expect(msg).toContain('reference: weird_code');
    expect(findJargon(msg)).toEqual([]);
  });
  test('non-ApiError fallback is plain', () => {
    expect(findJargon(explain(new Error('x')))).toEqual([]);
  });
});
