'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { addDays, dayLabel, hoursLabel, kes, mondayOf, parseHours, todayNairobi } from '@/lib/dates';

interface Entry { id: string; workDate: string; minutes: number; description: string; billable: boolean; invoiced: boolean; engagementId: string | null; engagementName: string | null }
interface Expense { id: string; spentOn: string; category: string; description: string; amount: string; rebillable: boolean; invoiced: boolean; engagementName: string | null }
interface Eng { id: string; clientName: string; periodEnd: string; member: boolean }

const CATEGORIES = ['fuel', 'transport', 'accommodation', 'meals', 'stationery', 'communication', 'other'] as const;

export default function TimesheetPage() {
  const me = useApi<{ userId: string }>('/me');
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayNairobi()));
  const weekEnd = addDays(weekStart, 6);
  const time = useApi<{ entries: Entry[]; totals: { minutes: number; billableMinutes: number } }>(me.data ? `/time?from=${weekStart}&to=${weekEnd}&userId=${me.data.userId}` : null);
  const expenses = useApi<{ expenses: Expense[] }>(me.data ? `/expenses?from=${weekStart}&to=${weekEnd}&userId=${me.data.userId}` : null);
  const engagements = useApi<{ engagements: Eng[] }>('/engagements');
  const mine = engagements.data?.engagements.filter((e) => e.member) ?? [];

  const [form, setForm] = useState({ date: todayNairobi(), engagementId: '', hours: '', description: '', billable: true });
  const [exp, setExp] = useState({ date: todayNairobi(), engagementId: '', category: 'fuel', description: '', amount: '', rebillable: true });
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const entries = time.data?.entries ?? [];
  const total = time.data?.totals.minutes ?? 0;
  const billable = time.data?.totals.billableMinutes ?? 0;

  async function addTime(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone('');
    const minutes = parseHours(form.hours);
    if (minutes === null) {
      setError(new Error('Enter the time as hours, for example 1.5, or as 1:30.'));
      return;
    }
    try {
      await api.post('/time', {
        workDate: form.date, minutes, description: form.description,
        ...(form.engagementId ? { engagementId: form.engagementId, billable: form.billable } : { billable: false }),
      });
      setDone(`Logged ${hoursLabel(minutes)}.`);
      setForm({ ...form, hours: '', description: '' });
      time.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function addExpense(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone('');
    try {
      await api.post('/expenses', { engagementId: exp.engagementId, spentOn: exp.date, category: exp.category, description: exp.description, amount: exp.amount, rebillable: exp.rebillable });
      setDone('Expense recorded.');
      setExp({ ...exp, description: '', amount: '' });
      expenses.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function remove(kind: 'time' | 'expenses', id: string) {
    setError(undefined);
    try {
      await api.del(`/${kind}/${id}`);
      (kind === 'time' ? time : expenses).reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Timesheet</h1><HelpLink topic="timesheet" /></div>
        <p>Record the time you spend, week by week. Time on an engagement can be billed to the client; time with no engagement is the firm's own. Only you see and change your own entries.</p>
      </div>
      <ErrorNote error={error} />
      {done && <Notice>{done}</Notice>}

      <section className="sheet row between">
        <div className="row">
          <button className="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous week</button>
          <button className="secondary" onClick={() => setWeekStart(mondayOf(todayNairobi()))}>This week</button>
          <button className="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week</button>
          <strong>{dayLabel(weekStart)} to {dayLabel(weekEnd)}</strong>
        </div>
        <div>
          <strong>{hoursLabel(total)}</strong> logged · <strong>{hoursLabel(billable)}</strong> billable{total > 0 && <> · {Math.round((billable / total) * 100)}% billable</>}
        </div>
      </section>

      <div className="week" role="list" aria-label="Your week">
        {days.map((d) => {
          const list = entries.filter((e) => e.workDate === d);
          const dayTotal = list.reduce((n, e) => n + e.minutes, 0);
          return (
            <section key={d} className={`day${d === todayNairobi() ? ' today' : ''}`} role="listitem" aria-label={dayLabel(d)}>
              <h3>{dayLabel(d)} <span className="small muted">{dayTotal > 0 ? hoursLabel(dayTotal) : ''}</span></h3>
              {list.map((e) => (
                <div key={e.id} className="event">
                  <div className="small muted">{hoursLabel(e.minutes)}{e.billable ? '' : ' · not billable'}{e.invoiced ? ' · billed' : ''}</div>
                  <strong>{e.description}</strong>
                  <div className="small">{e.engagementName ?? 'Firm time'}</div>
                  {!e.invoiced && <button className="quiet" onClick={() => remove('time', e.id)}>Delete</button>}
                </div>
              ))}
            </section>
          );
        })}
      </div>

      <form className="sheet stack" onSubmit={addTime}>
        <h2>Log time</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="td">Date</label><input id="td" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="te">Engagement</label>
            <select id="te" value={form.engagementId} onChange={(e) => setForm({ ...form, engagementId: e.target.value })}>
              <option value="">Firm time (not billable)</option>
              {mine.map((g) => <option key={g.id} value={g.id}>{g.clientName}, year ended {g.periodEnd}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="th">Time (hours)</label><input id="th" required placeholder="1.5 or 1:30" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></div>
          <div className="field"><label htmlFor="tw">What you did</label><input id="tw" required maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        {form.engagementId && <label className="row small"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Billable to the client</label>}
        <div><button>Log time</button></div>
      </form>

      <section className="sheet stack">
        <h2>Expenses this week</h2>
        {expenses.data?.expenses.length === 0 && <Empty>No expenses recorded this week.</Empty>}
        {expenses.data && expenses.data.expenses.length > 0 && (
          <table>
            <thead><tr><th>Date</th><th>Engagement</th><th>What</th><th>Amount</th><th /></tr></thead>
            <tbody>
              {expenses.data.expenses.map((x) => (
                <tr key={x.id}>
                  <td>{x.spentOn}</td><td>{x.engagementName}</td>
                  <td>{x.category}: {x.description}{x.rebillable ? '' : ' (not rebilled)'}{x.invoiced ? ' (billed)' : ''}</td>
                  <td>{kes(x.amount)}</td>
                  <td>{!x.invoiced && <button className="quiet" onClick={() => remove('expenses', x.id)}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form className="sheet stack" onSubmit={addExpense}>
        <h2>Record an expense on an engagement</h2>
        <p className="muted">Costs you incurred for the job, such as fuel to the client's premises. They can be added to the client's invoice. Keep the receipt and attach it as evidence on the engagement.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="xd">Date</label><input id="xd" type="date" required value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="xe">Engagement</label>
            <select id="xe" required value={exp.engagementId} onChange={(e) => setExp({ ...exp, engagementId: e.target.value })}>
              <option value="">Choose</option>
              {mine.map((g) => <option key={g.id} value={g.id}>{g.clientName}, year ended {g.periodEnd}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="xc">Category</label>
            <select id="xc" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="xw">What for</label><input id="xw" required maxLength={300} value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} /></div>
          <div className="field"><label htmlFor="xa">Amount (KES)</label><input id="xa" required inputMode="decimal" placeholder="5000.00" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} /></div>
        </div>
        <label className="row small"><input type="checkbox" checked={exp.rebillable} onChange={(e) => setExp({ ...exp, rebillable: e.target.checked })} /> Add to the client's invoice</label>
        <div><button>Record expense</button></div>
      </form>
    </div>
  );
}
