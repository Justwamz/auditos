import { describe, expect, test } from 'vitest';
import { readPref, writePref } from '../lib/prefs';

const throwing = () => {
  throw new Error('blocked');
};

describe('prefs', () => {
  test('readPref falls back when storage throws', () => {
    expect(readPref('view', 'list', { getItem: throwing })).toBe('list');
  });
  test('readPref falls back when the stored text is not valid JSON', () => {
    expect(readPref('view', 'list', { getItem: () => '{nope' })).toBe('list');
  });
  test('readPref falls back when the key is missing', () => {
    expect(readPref('view', 'list', { getItem: () => null })).toBe('list');
  });
  test('readPref returns the stored value, reading the aos: key', () => {
    let asked = '';
    const got = readPref('view', 'list', { getItem: (k) => ((asked = k), JSON.stringify('board')) });
    expect(got).toBe('board');
    expect(asked).toBe('aos:view');
  });
  test('writePref does not throw when setItem throws', () => {
    expect(() => writePref('view', 'board', { setItem: throwing })).not.toThrow();
  });
  test('writePref writes the aos: key with JSON text', () => {
    const seen: Record<string, string> = {};
    writePref('view', { a: 1 }, { setItem: (k, v) => void (seen[k] = v) });
    expect(seen).toEqual({ 'aos:view': '{"a":1}' });
  });
});
