import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const root = join(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === '.next' ? [] : files(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

test('every table sits inside a scroll wrapper or stacks on phones', () => {
  const bad: string[] = [];
  for (const f of [...files(join(root, 'app')), ...files(join(root, 'components'))]) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('<table')) return;
      if (line.includes('bp-table')) return;
      const near = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (/prospects-scroll/.test(near)) bad.push(`${f.slice(root.length + 1)}:${i + 1} (use TableScroll)`);
      else if (!/<TableScroll|table-scroll|stack-table/.test(near)) bad.push(`${f.slice(root.length + 1)}:${i + 1}`);
    });
  }
  expect(bad).toEqual([]);
});
