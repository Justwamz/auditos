export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const join = (base: string, key: string) => (base === '' ? key : `${base}.${key}`);

/** Leaf-level differences between two JSON documents. Keys are compared in sorted order, arrays by position. */
export function diffContent(before: unknown, after: unknown, path = ''): Change[] {
  if (isObject(before) || isObject(after)) {
    if (isObject(before) && isObject(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      return keys.flatMap((k) => diffContent(before[k], after[k], join(path, k)));
    }
    if (before === undefined && isObject(after) && path === '') return diffContent({}, after, path);
    return [{ path, before, after }];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const n = Math.max(before.length, after.length);
    return Array.from({ length: n }, (_, i) => diffContent(before[i], after[i], `${path}[${i}]`)).flat();
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }];
}
