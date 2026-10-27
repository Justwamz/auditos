import { describe, expect, test } from 'vitest';
import { diffContent } from '../src/doc-control/versions';

describe('diffContent', () => {
  test('no change gives no differences', () => {
    expect(diffContent({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x' } })).toEqual([]);
  });
  test('a changed leaf is reported with its dotted path, before and after', () => {
    expect(diffContent({ notes: 'old', n: { k: 1 } }, { notes: 'new', n: { k: 2 } })).toEqual([
      { path: 'n.k', before: 1, after: 2 },
      { path: 'notes', before: 'old', after: 'new' },
    ]);
  });
  test('added and removed keys are reported', () => {
    expect(diffContent({ a: 1 }, { b: 2 })).toEqual([
      { path: 'a', before: 1, after: undefined },
      { path: 'b', before: undefined, after: 2 },
    ]);
  });
  test('arrays are compared by position, with [n] in the path', () => {
    expect(diffContent({ items: [{ r: 'yes' }, { r: null }] }, { items: [{ r: 'yes' }, { r: 'no' }, { r: 'na' }] })).toEqual([
      { path: 'items[1].r', before: null, after: 'no' },
      { path: 'items[2]', before: undefined, after: { r: 'na' } },
    ]);
  });
  test('a type change is one difference at that path', () => {
    expect(diffContent({ a: { b: 1 } }, { a: 'text' })).toEqual([{ path: 'a', before: { b: 1 }, after: 'text' }]);
  });
  test('comparing with nothing (the first version) lists each top-level value as added, whole', () => {
    expect(diffContent(undefined, { a: 1, b: { c: 2 } })).toEqual([
      { path: 'a', before: undefined, after: 1 },
      { path: 'b', before: undefined, after: { c: 2 } },
    ]);
  });
});
