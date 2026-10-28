'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { eventsOnDay, KIND_STYLES, label, layoutDay, timeOf, today } from '@/lib/calendar';
import type { CalEvent, Milestone } from './types';

/** One minute is this many pixels tall. Every position on the grid comes from this number. */
export const PX_PER_MINUTE = 1;
/** An event with no length still gets a block this tall, so it can be seen and clicked. */
export const MIN_BLOCK_PX = 24;
const HOUR_PX = 60 * PX_PER_MINUTE;
const FIRST_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAY_MS = 24 * 60 * 60 * 1000;

/** All-day events and events that last a day or more sit in the strip above the hours. */
export const isAllDay = (e: Pick<CalEvent, 'allDay' | 'startsAt' | 'endsAt'>) =>
  e.allDay || new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime() >= DAY_MS;

export interface GridColumn {
  key: string;
  day: string;
  head: ReactNode;
  headClass?: string;
  name?: string;
  /** Events for the strip. */
  allDay: CalEvent[];
  /** Events for the hours (all-day ones are not in here). */
  timed: CalEvent[];
  marks?: Milestone[];
}

function useNowMinute(): { day: string; minutes: number } {
  const read = () => {
    const [h, m] = timeOf(new Date().toISOString()).split(':').map(Number);
    return { day: today(), minutes: (h ?? 0) * 60 + (m ?? 0) };
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setNow(read()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** One event as a soft coloured block: kind icon, time and title. The kind is also said in words for screen readers. */
function Block({ event, col, cols, top, height, onOpen }: { event: CalEvent; col: number; cols: number; top: number; height: number; onOpen: (e: CalEvent) => void }) {
  const k = KIND_STYLES[event.kind] ?? KIND_STYLES.other!;
  const px = Math.max(height * PX_PER_MINUTE, MIN_BLOCK_PX);
  const range = event.startsAt === event.endsAt ? timeOf(event.startsAt) : `${timeOf(event.startsAt)} to ${timeOf(event.endsAt)}`;
  // Side by side, a block is narrow: show just the start; the full range is in the tooltip and the details.
  const startOnly = cols > 1 || px < 44 || event.startsAt === event.endsAt;
  return (
    <button
      type="button"
      className={`cal-block${px < 44 ? ' is-short' : px < 72 ? ' is-hour' : ''}${cols > 1 ? ' is-narrow' : ''}`}
      data-cols={Math.min(cols, 5)}
      aria-label={`${k.label}: ${event.title}, ${range}`}
      title={`${k.label}: ${event.title}, ${range}`}
      style={{
        top: top * PX_PER_MINUTE,
        height: px,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
        ['--k' as string]: `var(${k.token})`,
        ['--kw' as string]: `var(${k.token}-wash)`,
      }}
      onClick={() => onOpen(event)}
    >
      <span className="cal-block-time"><span className="cal-block-icon" aria-hidden="true">{k.icon} </span><span className="cal-block-when">{timeOf(event.startsAt)}{!startOnly && <span className="cal-block-end"> to {timeOf(event.endsAt)}</span>}</span></span>
      <span className="cal-block-title">{event.title}</span>
    </button>
  );
}

function StripItem({ event, onOpen }: { event: CalEvent; onOpen: (e: CalEvent) => void }) {
  const k = KIND_STYLES[event.kind] ?? KIND_STYLES.other!;
  return (
    <button type="button" className="cal-strip-item" style={{ ['--k' as string]: `var(${k.token})`, ['--kw' as string]: `var(${k.token}-wash)` }} onClick={() => onOpen(event)}>
      <span aria-hidden="true">{k.icon} </span><span className="sr-only">{k.label}: </span>{event.title}
    </button>
  );
}

/** Hours down the side, one column per entry, an all-day strip on top. Shared by the days of a week and by people on one day. */
export function HourGrid({ columns, onOpen, ariaLabel }: { columns: GridColumn[]; onOpen: (e: CalEvent) => void; ariaLabel: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNowMinute();
  useEffect(() => {
    // Open at 07:00; the rest of the day is a scroll away.
    if (scroller.current) scroller.current.scrollTop = FIRST_HOUR * HOUR_PX;
  }, []);
  const style = { ['--cols' as string]: columns.length, ['--colmin' as string]: columns.length >= 6 ? '140px' : '104px' };
  return (
    <div ref={scroller} className="cal-scroll" role="group" aria-label={ariaLabel} style={style}>
      <div className="cal-tg-head">
        <div className="cal-gutter" />
        {columns.map((c) => <div key={c.key} className={`cal-col-head ${c.headClass ?? ''}`}>{c.head}</div>)}
      </div>
      <div className="cal-strip">
        <div className="cal-gutter cal-strip-label">All day</div>
        {columns.map((c) => (
          <div key={c.key} className="cal-strip-cell" data-col={c.key}>
            {(c.marks ?? []).map((m) => (
              <div key={`${m.engagementId}-${m.kind}`} className="cal-milestone">
                <span className="cal-diamond" aria-hidden="true" />
                <span>{m.title}</span>
              </div>
            ))}
            {c.allDay.map((e) => <StripItem key={e.id} event={e} onOpen={onOpen} />)}
          </div>
        ))}
      </div>
      <div className="cal-body">
        <div className="cal-gutter">
          {HOURS.map((h) => <div key={h} className="cal-hour">{String(h).padStart(2, '0')}:00</div>)}
        </div>
        {columns.map((c) => (
          <div key={c.key} className="cal-col" data-col={c.key} data-name={c.name}>
            {layoutDay(c.timed, c.day).map((l) => <Block key={l.event.id} {...l} onOpen={onOpen} />)}
            {c.day === now.day && <div className="cal-now" style={{ top: now.minutes * PX_PER_MINUTE }} aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One day's events, split into the strip and the hours. */
export const splitDay = (events: CalEvent[], day: string) => {
  const here = eventsOnDay(events, day);
  return { allDay: here.filter(isAllDay), timed: here.filter((e) => !isAllDay(e)) };
};

/** The days of a Day, Work week or Week view. Clicking a day's heading (when `onOpenDay` is given) opens that day. */
export function TimeGrid({
  days, events, milestones, onOpen, onOpenDay,
}: {
  days: string[];
  events: CalEvent[];
  milestones: Milestone[];
  meId: string;
  onOpen: (e: CalEvent) => void;
  onOpenDay?: (day: string) => void;
}) {
  const now = today();
  const columns: GridColumn[] = days.map((d) => {
    const dow = label(d).split(/[ ,]+/)[0];
    const num = Number(d.slice(8));
    const inner = (
      <>
        <span className="cal-dow">{dow}</span>
        <span className={`cal-num${d === now ? ' is-today' : ''}`}>{num}</span>
      </>
    );
    return {
      key: d,
      day: d,
      head: onOpenDay ? (
        <button type="button" className="cal-day-head" aria-label={`Open ${label(d)}`} aria-current={d === now ? 'date' : undefined} onClick={() => onOpenDay(d)}>{inner}</button>
      ) : (
        <div className="cal-day-head" aria-current={d === now ? 'date' : undefined}>{inner}</div>
      ),
      marks: milestones.filter((m) => m.date === d),
      ...splitDay(events, d),
    };
  });
  return <HourGrid columns={columns} onOpen={onOpen} ariaLabel={days.length === 1 ? 'Day' : days.length === 5 ? 'Work week' : 'Week'} />;
}
