import { describe, expect, test } from 'vitest';
import { config } from '../middleware';

// Next turns the matcher into a pattern over the whole path; the same shape is checked here.
const matcher = new RegExp(`^${config.matcher[0]!}$`);
const runs = (path: string) => matcher.test(path);

describe('middleware matcher', () => {
  test('skips exactly the icons, the worker and static build files', () => {
    expect(runs('/icons/auditos-192.png')).toBe(false);
    expect(runs('/icons/auditos.svg')).toBe(false);
    expect(runs('/sw.js')).toBe(false);
    expect(runs('/_next/static/chunks/a.js')).toBe(false);
  });

  test('everything else still goes through the middleware', () => {
    for (const p of ['/icons/x/y', '/icons/', '/sw.js/x', '/swXjs', '/clients', '/offline', '/site.webmanifest', '/api/me'])
      expect(runs(p), p).toBe(true);
  });
});
