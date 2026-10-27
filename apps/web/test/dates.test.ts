import { describe, expect, test } from 'vitest';
import { addDays, hoursLabel, kes, monthEnd, monthStart, mondayOf, parseHours } from '../lib/dates';

describe('dates', () => {
  test('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('the Monday of any day of the week, Sunday included', () => {
    expect(mondayOf('2026-11-10')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
  });
  test('the first and last day of the month, leap years included', () => {
    expect(monthStart('2026-11-27')).toBe('2026-11-01');
    expect(monthEnd('2026-11-27')).toBe('2026-11-30');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(monthEnd('2026-12-01')).toBe('2026-12-31');
  });
});

describe('hours', () => {
  test('decimal or clock style, between one minute and a day', () => {
    expect(parseHours('1.5')).toBe(90);
    expect(parseHours('2')).toBe(120);
    expect(parseHours('1:30')).toBe(90);
    expect(parseHours('0:05')).toBe(5);
    expect(parseHours('0.25')).toBe(15);
  });
  test('anything else is refused', () => {
    for (const bad of ['', 'abc', '0', '-1', '25', '1:75', '1,5', '1.234', '99:00']) expect(parseHours(bad), bad).toBeNull();
  });
  test('shown as hours and minutes', () => {
    expect(hoursLabel(90)).toBe('1h 30m');
    expect(hoursLabel(125)).toBe('2h 05m');
  });
});

describe('money', () => {
  test('KES with separators, two decimals', () => {
    expect(kes('1500')).toBe('KES 1,500.00');
    expect(kes('1234567.5')).toBe('KES 1,234,567.50');
    expect(kes(null)).toBe('');
  });
});
