// Pure calendar logic. Calendar days are always Nairobi days (UTC+3, no daylight saving).
const TZ = 'Africa/Nairobi';
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MIN = 24 * 60;

export const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mondayOf = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
};
export const label = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const today = () => dayOf(new Date().toISOString());

type Span = { startsAt: string; endsAt: string };

// Minutes since the Nairobi 1970-01-01 00:00 (Nairobi has a fixed offset).
const nairobiMinutes = (iso: string) => Math.floor((new Date(iso).getTime() + OFFSET_MS) / 60000);
const dayStartMinutes = (day: string) => Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 60000);

// First and last Nairobi day an event covers. An end exactly at 00:00 belongs to the day before;
// an end before the start is treated as ending at the start.
function coverage(e: Span): { first: string; last: string } {
  const first = dayOf(e.startsAt);
  if (new Date(e.endsAt).getTime() <= new Date(e.startsAt).getTime()) return { first, last: first };
  const endMin = nairobiMinutes(e.endsAt);
  const last = dayOf(new Date(new Date(e.endsAt).getTime() - (endMin % DAY_MIN === 0 ? 60000 : 0)).toISOString());
  return { first, last: last < first ? first : last };
}

export function eventsOnDay<E extends Span>(events: E[], day: string): E[] {
  return events.filter((e) => {
    const { first, last } = coverage(e);
    return first <= day && day <= last;
  });
}

type Person = { id: string; name: string };

export function peopleOf(e: { createdBy: string; createdByName: string; attendees: Person[] }): Person[] {
  const out: Person[] = [{ id: e.createdBy, name: e.createdByName }];
  for (const a of e.attendees) if (!out.some((p) => p.id === a.id)) out.push({ id: a.id, name: a.name });
  return out;
}

export function groupByPerson<E extends Span & { createdBy: string; createdByName: string; attendees: Person[] }>(
  events: E[], day: string, meId: string,
): { id: string; name: string; isMe: boolean; events: E[] }[] {
  const groups = new Map<string, { id: string; name: string; isMe: boolean; events: E[] }>();
  for (const e of eventsOnDay(events, day)) {
    for (const p of peopleOf(e)) {
      const g = groups.get(p.id) ?? { id: p.id, name: p.name, isMe: p.id === meId, events: [] };
      g.events.push(e);
      groups.set(p.id, g);
    }
  }
  return [...groups.values()].sort((a, b) => (a.isMe === b.isMe ? a.name.localeCompare(b.name) : a.isMe ? -1 : 1));
}

export function monthGrid(anchor: string): string[][] {
  const first = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = addDays(next.toISOString().slice(0, 10), -1);
  const start = mondayOf(first);
  const weeks = Math.round((dayStartMinutes(mondayOf(lastDay)) - dayStartMinutes(start)) / (7 * DAY_MIN)) + 1;
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

// Minutes from 00:00 within a day, clipped to that day. `day` defaults to the event's start day.
export function layoutDay<E extends Span>(events: E[], day?: string): { event: E; col: number; cols: number; top: number; height: number }[] {
  const items = events.map((event) => {
    const d = dayStartMinutes(day ?? dayOf(event.startsAt));
    const start = Math.max(nairobiMinutes(event.startsAt) - d, 0);
    const rawEnd = nairobiMinutes(event.endsAt) - d;
    const begin = Math.min(start, DAY_MIN);
    const end = Math.min(Math.max(rawEnd, begin), DAY_MIN);
    return { event, begin, end };
  });
  const order = items.map((_, i) => i).sort((a, b) => items[a].begin - items[b].begin || items[a].end - items[b].end);
  const col: number[] = [];
  const cols: number[] = [];
  let cluster: number[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const close = () => { for (const i of cluster) cols[i] = colEnds.length; cluster = []; colEnds = []; };
  for (const i of order) {
    if (cluster.length && items[i].begin >= clusterEnd) close();
    let c = colEnds.findIndex((end) => end <= items[i].begin);
    if (c === -1) c = colEnds.length;
    colEnds[c] = items[i].end;
    col[i] = c;
    cluster.push(i);
    clusterEnd = cluster.length === 1 ? items[i].end : Math.max(clusterEnd, items[i].end);
  }
  close();
  return items.map((it, i) => ({ event: it.event, col: col[i], cols: cols[i], top: it.begin, height: it.end - it.begin }));
}

export const KIND_STYLES: Record<string, { label: string; token: string; icon: string }> = {
  meeting: { label: 'Meeting', token: '--ledger', icon: '●' },
  fieldwork: { label: 'Fieldwork', token: '--ledger-deep', icon: '▲' },
  deadline: { label: 'Deadline', token: '--red-pen', icon: '⚑' },
  leave: { label: 'Leave', token: '--amber', icon: '☀' },
  training: { label: 'Training', token: '--pencil', icon: '✎' },
  other: { label: 'Other', token: '--pencil', icon: '◆' },
};
