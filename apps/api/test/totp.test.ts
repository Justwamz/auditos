import { describe, expect, test } from 'vitest';
import { base32Decode, base32Encode, generateSecret, otpauthUri, stepOf, totpAt, verifyTotp } from '../src/security/totp';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890"

describe('totp', () => {
  test('matches the RFC 6238 SHA-1 test vector at t=59s', () => {
    expect(totpAt(RFC_SECRET, stepOf(59_000))).toBe('287082');
    expect(totpAt(RFC_SECRET, stepOf(1_111_111_109_000))).toBe('081804');
  });
  test('base32 round trips', () => {
    const s = generateSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
  });
  test('verify accepts ±1 step and returns the matched step, rejects others', () => {
    const now = 1_700_000_000_000;
    const step = stepOf(now);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '000000x', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '', now)).toBeNull();
  });
  test('otpauth uri carries issuer and account', () => {
    const u = otpauthUri(RFC_SECRET, 'a@example.test', 'AuditOS');
    expect(u).toContain('otpauth://totp/AuditOS:a%40example.test');
    expect(u).toContain('issuer=AuditOS');
    expect(u).toContain(`secret=${RFC_SECRET}`);
  });
});
