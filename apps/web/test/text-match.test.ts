import { describe, expect, test } from 'vitest';
import { matchesQuery } from '../lib/text-match';

describe('matchesQuery', () => {
  test('an empty search matches everything', () => {
    expect(matchesQuery('  ', 'anything')).toBe(true);
  });
  test('every word must be found, in any field, ignoring case', () => {
    expect(matchesQuery('mwangaza ka-2026', 'Mwangaza Traders Ltd', 'KA-2026-0001')).toBe(true);
    expect(matchesQuery('mwangaza lakeview', 'Mwangaza Traders Ltd', 'KA-2026-0001')).toBe(false);
  });
  test('missing fields are ignored', () => {
    expect(matchesQuery('draft', null, undefined, 'Draft')).toBe(true);
  });
});
