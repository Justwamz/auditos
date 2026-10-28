import { describe, expect, test } from 'vitest';
import { matchesQuery, mailText } from '../lib/billing';
import { findJargon } from '../lib/plain';

describe('mailText', () => {
  const body = ['Please find invoice KA-2026-0001.', '', 'Amount due: KES 100.00', '', 'Email delivery is simulated: this message was kept in the outbox and not sent.'].join('\n');
  test('drops the system line about how delivery works, and keeps the message', () => {
    const t = mailText(body);
    expect(t).toBe('Please find invoice KA-2026-0001.\n\nAmount due: KES 100.00');
    expect(findJargon(t)).toEqual([]);
  });
  test('leaves a message without that line alone', () => {
    expect(mailText('Hello\n\nBye')).toBe('Hello\n\nBye');
  });
});

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
