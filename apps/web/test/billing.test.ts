import { describe, expect, test } from 'vitest';
import { mailText } from '../lib/billing';
import { findJargon } from '../lib/plain';

describe('mailText', () => {
  const body = ['Please find invoice KA-2026-0001.', '', 'Amount due: KES 100.00', '', 'Email delivery is simulated: this message was kept in the outbox and not sent.'].join('\n');
  test('drops the system line about how delivery works, and keeps the message', () => {
    const t = mailText(body);
    expect(t).toBe('Please find invoice KA-2026-0001.\n\nAmount due: KES 100.00');
    expect(findJargon(t)).toEqual([]);
  });
  test('also drops the practice-mode line the system adds now', () => {
    expect(mailText('Hello

Practice mode: this message was kept in Sent emails and not actually sent.')).toBe('Hello');
  });
  test('leaves a message without that line alone', () => {
    expect(mailText('Hello\n\nBye')).toBe('Hello\n\nBye');
  });
});
