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
    expect(mailText('Hello\n\nPractice mode: this message was kept in Sent emails and not actually sent.')).toBe('Hello');
  });
  test('keeps the letterhead lines and the closing Powered by AuditOS line', () => {
    const mail = ['Kangethe & Associates', 'Nairobi', 'Tel: +254 700 111 222', '', 'Please find invoice KA-1.', '', 'Practice mode: this message was kept in Sent emails and not actually sent.', '', 'Powered by AuditOS'].join('\n');
    expect(mailText(mail)).toBe('Kangethe & Associates\nNairobi\nTel: +254 700 111 222\n\nPlease find invoice KA-1.\n\nPowered by AuditOS');
  });
  test('leaves a message without that line alone', () => {
    expect(mailText('Hello\n\nBye')).toBe('Hello\n\nBye');
  });
});
