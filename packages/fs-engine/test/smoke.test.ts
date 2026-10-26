import { expect, test } from 'vitest';
import { version } from '../src';

test('toolchain runs', () => {
  expect(version()).toBe('0.0.0');
});
