import { describe, expect, test } from 'vitest';
import { maskEmail, maskId, maskPhone, maskPin } from '../src/contacts/mask';

describe('masking personal data', () => {
  test('phone numbers keep only the last three digits and their layout', () => {
    expect(maskPhone('0712 345 678')).toBe('•••• ••• 678');
    expect(maskPhone('+254712345678')).toBe('+•••••••••678');
    expect(maskPhone('+254 712 345 678')).toBe('+••• ••• ••• 678');
  });
  test('email keeps the first letter and the domain', () => {
    expect(maskEmail('grace.kangethe@kangethe.co.ke')).toBe('g•••@kangethe.co.ke');
    expect(maskEmail('a@b.co')).toBe('•••@b.co');
  });
  test('ID numbers keep the last three characters', () => {
    expect(maskId('12345678')).toBe('•••••678');
  });
  test('KRA PINs keep the last three characters', () => {
    expect(maskPin('A012345678B')).toBe('••••••••78B');
  });
  test('short values are hidden completely', () => {
    expect(maskId('1234')).toBe('••••');
    expect(maskPin('AB')).toBe('••');
    expect(maskPhone('123')).toBe('•••');
  });
  test('no masked value ever contains more than three of the original characters', () => {
    const samples: [(v: string) => string, string][] = [
      [maskPhone, '0712345678'], [maskId, '12345678'], [maskPin, 'P051234567Q'], [maskEmail, 'peter.mwangi@example.com'],
    ];
    for (const [fn, value] of samples) {
      const local = value.includes('@') ? value.split('@')[0]! : value;
      const out = fn(value).split('@')[0]!;
      const leaked = [...out].filter((c) => c !== '•' && c !== ' ' && c !== '+').length;
      expect(leaked, value).toBeLessThanOrEqual(3);
      expect(out.length).toBeLessThanOrEqual(Math.max(local.length, 4) + 3);
    }
  });
  test('empty values stay empty', () => {
    expect(maskPhone('')).toBe('');
    expect(maskEmail('')).toBe('');
  });
});
