import { describe, expect, test } from 'vitest';
import {
  KIND_STYLES, addDays, dayOf, eventsOnDay, groupByPerson, layoutDay, monthGrid, mondayOf, peopleOf, timeOf,
} from '../lib/calendar';

const ev = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });

describe('Nairobi dates', () => {
  test('dayOf uses Nairobi (UTC+3)', () => {
    expect(dayOf('2026-11-03T20:30:00Z')).toBe('2026-11-03');
    expect(dayOf('2026-11-03T21:30:00Z')).toBe('2026-11-04');
  });
  test('timeOf is HH:mm in Nairobi', () => {
    expect(timeOf('2026-11-03T20:30:00Z')).toBe('23:30');
    expect(timeOf('2026-11-03T21:00:00Z')).toBe('00:00');
  });
  test('addDays and mondayOf', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sunday
    expect(mondayOf('2026-11-02')).toBe('2026-11-02'); // Monday
    expect(mondayOf('2026-11-04')).toBe('2026-11-02');
  });
});

describe('eventsOnDay', () => {
  test('a Mon to Wed leave event appears on three days only', () => {
    const leave = ev('l', '2026-11-02T06:00:00Z', '2026-11-04T15:00:00Z'); // Mon 09:00 to Wed 18:00
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    expect(days.map((d) => eventsOnDay([leave], d).length)).toEqual([0, 1, 1, 1, 0]);
  });
  test('an event ending exactly at 00:00 does not appear on the next day', () => {
    const e = ev('a', '2026-11-02T18:00:00Z', '2026-11-02T21:00:00Z'); // 21:00 Mon to 00:00 Tue
    expect(eventsOnDay([e], '2026-11-02')).toHaveLength(1);
    expect(eventsOnDay([e], '2026-11-03')).toHaveLength(0);
  });
  test('an event spanning midnight appears on both days', () => {
    const e = ev('a', '2026-11-02T19:00:00Z', '2026-11-02T23:00:00Z'); // 22:00 to 02:00
    expect(eventsOnDay([e], '2026-11-02')).toHaveLength(1);
    expect(eventsOnDay([e], '2026-11-03')).toHaveLength(1);
  });
  test('an all-day event (midnight to midnight) covers only its day', () => {
    const e = ev('a', '2026-11-02T21:00:00Z', '2026-11-03T21:00:00Z'); // Tue 00:00 to Wed 00:00
    expect(eventsOnDay([e], '2026-11-03')).toHaveLength(1);
    expect(eventsOnDay([e], '2026-11-04')).toHaveLength(0);
  });
  test('23:30 Nairobi lands on its own day', () => {
    const e = ev('a', '2026-11-03T20:30:00Z', '2026-11-03T20:45:00Z');
    expect(eventsOnDay([e], '2026-11-03')).toHaveLength(1);
    expect(eventsOnDay([e], '2026-11-04')).toHaveLength(0);
  });
  test('an event ending before it starts does not throw and shows on its start day', () => {
    const e = ev('a', '2026-11-03T10:00:00Z', '2026-11-02T10:00:00Z');
    expect(() => eventsOnDay([e], '2026-11-03')).not.toThrow();
    expect(eventsOnDay([e], '2026-11-03')).toHaveLength(1);
    expect(eventsOnDay([e], '2026-11-02')).toHaveLength(0);
  });
});

describe('people', () => {
  const e = {
    createdBy: 'u2', createdByName: 'Zed',
    attendees: [{ id: 'u1', name: 'Amy' }, { id: 'u2', name: 'Zed' }, { id: 'u3', name: 'Bob' }],
  };
  test('peopleOf lists the creator first, no duplicates', () => {
    expect(peopleOf(e).map((p) => p.id)).toEqual(['u2', 'u1', 'u3']);
  });
  test('groupByPerson puts me first, the rest alphabetical, no duplicate people', () => {
    const events = [{ ...e, startsAt: '2026-11-03T06:00:00Z', endsAt: '2026-11-03T07:00:00Z' }];
    const groups = groupByPerson(events, '2026-11-03', 'u3');
    expect(groups.map((g) => g.id)).toEqual(['u3', 'u1', 'u2']);
    expect(groups.map((g) => g.isMe)).toEqual([true, false, false]);
    expect(groups.every((g) => g.events.length === 1)).toBe(true);
  });
  test('groupByPerson skips events on other days and omits me when absent', () => {
    const events = [{ ...e, startsAt: '2026-11-04T06:00:00Z', endsAt: '2026-11-04T07:00:00Z' }];
    expect(groupByPerson(events, '2026-11-03', 'u1')).toEqual([]);
    expect(groupByPerson(events, '2026-11-04', 'nobody').map((g) => g.id)).toEqual(['u1', 'u3', 'u2']);
  });
});

describe('monthGrid', () => {
  test('weeks run Monday to Sunday and cover the month', () => {
    const grid = monthGrid('2026-11-15');
    expect(grid[0]?.[0]).toBe('2026-10-26');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat()).toContain('2026-11-30');
    expect(grid.at(-1)![6]).toBe('2026-12-06');
  });
  test('a month starting on Monday has no leading days', () => {
    expect(monthGrid("2026-06-10")[0]?.[0]).toBe('2026-06-01');
  });
});

describe('layoutDay', () => {
  test('overlapping events share two columns', () => {
    const out = layoutDay([
      ev('a', '2026-11-03T06:00:00Z', '2026-11-03T08:00:00Z'), // 09:00-11:00
      ev('b', '2026-11-03T07:00:00Z', '2026-11-03T09:00:00Z'), // 10:00-12:00
    ]);
    expect(out.map((o) => o.cols)).toEqual([2, 2]);
    expect(new Set(out.map((o) => o.col)).size).toBe(2);
    expect(out[0]?.top).toBe(540);
    expect(out[0]?.height).toBe(120);
  });
  test('back-to-back events do not share columns', () => {
    const out = layoutDay([
      ev('a', '2026-11-03T06:00:00Z', '2026-11-03T07:00:00Z'),
      ev('b', '2026-11-03T07:00:00Z', '2026-11-03T08:00:00Z'),
    ]);
    expect(out.map((o) => o.cols)).toEqual([1, 1]);
    expect(out.map((o) => o.col)).toEqual([0, 0]);
  });
  test('an event from 22:00 to 02:00 is clipped to 22:00-24:00 on the first day', () => {
    const [o] = layoutDay([ev('a', '2026-11-03T19:00:00Z', '2026-11-03T23:00:00Z')]);
    expect(o?.top).toBe(1320);
    expect(o?.height).toBe(120);
  });
  test('the same event is clipped to 00:00-02:00 on the next day', () => {
    const [o] = layoutDay([ev('a', '2026-11-03T19:00:00Z', '2026-11-03T23:00:00Z')], '2026-11-04');
    expect(o?.top).toBe(0);
    expect(o?.height).toBe(120);
  });
  test('an event ending before it starts does not throw', () => {
    const [o] = layoutDay([ev('a', '2026-11-03T10:00:00Z', '2026-11-03T08:00:00Z')]);
    expect(o?.height).toBe(0);
  });
});

describe('KIND_STYLES', () => {
  test('has plain labels and a glyph for each kind', () => {
    expect(Object.keys(KIND_STYLES)).toEqual(['meeting', 'fieldwork', 'deadline', 'leave', 'training', 'other']);
    for (const s of Object.values(KIND_STYLES)) {
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.token).toMatch(/^--[a-z-]+$/);
    }
    expect(KIND_STYLES.deadline?.label).toBe('Deadline');
  });
});
