import { describe, expect, test } from 'vitest';
import { trapTarget } from '../lib/focus';

describe('trapTarget', () => {
  const items = ['a', 'b', 'c'];
  test('Tab on the last visible control wraps to the first', () => {
    expect(trapTarget(items, 'c', null, false)).toBe('a');
  });
  test('Shift+Tab on the first control wraps to the last', () => {
    expect(trapTarget(items, 'a', null, true)).toBe('c');
  });
  test('Shift+Tab from the dialog itself goes to the last', () => {
    expect(trapTarget(items, 'box', 'box', true)).toBe('c');
  });
  test('focus outside the visible list is pulled back in', () => {
    expect(trapTarget(items, 'hidden', null, false)).toBe('a');
  });
  test('middle controls move normally', () => {
    expect(trapTarget(items, 'b', null, false)).toBeNull();
    expect(trapTarget(items, 'b', null, true)).toBeNull();
  });
  test('no visible controls: nothing to wrap to', () => {
    expect(trapTarget([], null, null, false)).toBeNull();
  });
});
