'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { RowMenu } from '@/components/ui/RowMenu';
import { SectionHead } from '@/components/ui/SectionHead';
import { SidePanel } from '@/components/ui/SidePanel';
import { addDays, dayLabel, hoursLabel, kes, mondayOf, parseHours, todayNairobi } from '@/lib/dates';

interface Entry { id: string; workDate: string; minutes: number; description: string; billable: boolean; invoiced: boolean; engagementId: string | null; engagementName: string | null }
interface Expense { id: string; spentOn: string; category: string; description: string; amount: string; rebillable: boolean; invoiced: boolean; engagementName: string | null }
interface Eng { id: string; clientName: string; periodEnd: string; member: boolean }

const CATEGORIES = ['fuel', 'transport', 'accommodation', 'meals', 'stationery', 'communication', 'other'] as const;
const TIME_FORM = 'log-time-form';
const EXPENSE_FORM = 'record-expense-form';
const blankTime = () => ({ date: todayNairobi(), engagementId: '', hours: '', description: '', billable: true });
const blankExpense = () => ({ date: todayNairobi(), engagementId: '', category: 'fuel', description: '', amount: '', rebillable: true });

export default function TimesheetPage() {
  const me = useApi<{ userId: string }>('/me');
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayNairobi()));
  const weekEnd = addDays(weekStart, 6);
  const time = useApi<{ entries: Entry[]; totals: { minutes: number; billableMinutes: number } }>(me.data ? `/time?from=${weekStart}&to=${weekEnd}&userId=${me.data.userId}` : null);
  const expenses = useApi<{ expenses: Expense[] }>(me.data ? `/expenses?from=${weekStart}&to=${weekEnd}&userId=${me.data.userId}` : null);
  const engagements = useApi<{ engagements: Eng[] }>('/engagements');
  const mine = engagements.data?.engagements.filter((e) => e.member) ?? [];

  const [form, setForm] = useState(blankTime);
  const [exp, setExp] = useState(blankExpense);
  const [panel, setPanel] = useState<'time' | 'expense' | null>(null);
  const [panelError, setPanelError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  const entries = [...(time.data?.entries ?? [])].sort((a, b) => a.workDate.localeCompare(b.workDate));
  const total = time.data?.totals.minutes ?? 0;
  const billable = time.data?.totals.billableMinutes ?? 0;
  const loading = !time.data || !expenses.data;

  function openPanel(which: 'time' | 'expense') {
    setDone('');
    setError(undefined);
    setPanelError(undefined);
    setPanel(which);
  }
  function close() {
    setPanel(null);
    setPanelError(undefined);
    setBusy(false);
  }

  async function addTime(ev: FormEvent) {
    ev.preventDefault();
    setPanelError(undefined);
    const minutes = parseHours(form.hours);
    if (minutes === null) {
      setPanelError(new Error('Enter the time as hours, for example 1.5, or as 1:30.'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/time', {
        workDate: form.date, minutes, description: form.description,
        ...(form.engagementId ? { engagementId: form.engagementId, billable: form.billable } : { billable: false }),
      });
      setDone(`Logged ${hoursLabel(minutes)}.`);
      setForm({ ...form, hours: '', description: '' });
      close();
      time.reload();
    } catch (e) {
      setPanelError(e);
      setBusy(false);
    }
  }

  async function addExpense(ev: FormEvent) {
    ev.preventDefault();
    setPanelError(undefined);
    setBusy(true);
    try {
      await api.post('/expenses', { engagementId: exp.engagementId, spentOn: exp.date, category: exp.category, description: exp.description, amount: exp.amount, rebillable: exp.rebillable });
      setDone('Expense recorded.');
      setExp({ ...exp, description: '', amount: '' });
      close();
      expenses.reload();
    } catch (e) {
      setPanelError(e);
      setBusy(false);
    }
  }

  async function remove(kind: 'time' | 'expenses', id: string) {
    setError(undefined);
    setDone('');
    try {
      await api.del(`/${kind}/${id}`);
      (kind === 'time' ? time : expenses).reload();
    } catch (e) {
      setError(e);
    }
  }

  const actions = (
    <>
      <button type="button" className="secondary" onClick={() => openPanel('expense')}>+ Record expense</button>
      <button type="button" onClick={() => openPanel('time')}>+ Log time</button>
    </>
  );

  return (
    <div className="stack-lg">
      <PageHead
        title="Timesheet"
        sentence="Record the time you spend, week by week. Time on an engagement can be billed to the client; time with no engagement is the firm's own. Only you see and change your own entries."
        action={actions}
        help={<HelpLink topic="timesheet" />}
      />
      <ErrorNote error={error ?? time.error ?? expenses.error} />
      {done && <Notice>{done}</Notice>}

      <div className="cal-toolbar">
        <div className="row">
          <button type="button" className="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous week</button>
          <button type="button" className="secondary" onClick={() => setWeekStart(mondayOf(todayNairobi()))}>Today</button>
          <button type="button" className="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week</button>
          <h2 className="cal-month-title">{dayLabel(weekStart)} to {dayLabel(weekEnd)}</h2>
        </div>
        <div className="small" role="status" aria-live="polite">
          <strong>{hoursLabel(total)}</strong> logged · <strong>{hoursLabel(billable)}</strong> billable{total > 0 && <> · {Math.round((billable / total) * 100)}% billable</>}
        </div>
      </div>

      {loading ? (
        <section className="sheet prospects-loading" aria-label="Loading your week">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      ) : (
        <>
          <section className="sheet prospects-sheet" aria-label="Time this week">
            {entries.length === 0 ? (
              <EmptyState kind="calendar" title="No time logged this week">
                Use + Log time at the top to add what you worked on.
              </EmptyState>
            ) : (
              <div className="prospects-scroll">
                <table className="prospects-table">
                  <thead><tr><th>Date</th><th>What you did</th><th>Engagement</th><th className="num">Time</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td>{dayLabel(e.workDate)}</td>
                        <td><strong>{e.description}</strong></td>
                        <td>{e.engagementName ?? 'Firm time'}</td>
                        <td className="num">{hoursLabel(e.minutes)}</td>
                        <td className="muted">{e.invoiced ? 'Billed' : e.billable ? 'To bill' : 'Not billable'}</td>
                        <td className="right">
                          <RowMenu label={`Actions for ${e.description}`} items={[{ label: 'Delete', danger: true, hidden: e.invoiced, onSelect: () => remove('time', e.id) }]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <SectionHead title="Expenses this week" sentence="Costs you incurred for a job, such as fuel to the client's premises." />
          <section className="sheet prospects-sheet" aria-label="Expenses this week">
            {expenses.data?.expenses.length === 0 ? (
              <EmptyState kind="ledger" title="No expenses this week">
                Use + Record expense at the top to add a cost.
              </EmptyState>
            ) : (
              <div className="prospects-scroll">
                <table className="prospects-table">
                  <thead><tr><th>Date</th><th>Engagement</th><th>What</th><th className="num">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {expenses.data?.expenses.map((x) => (
                      <tr key={x.id}>
                        <td>{x.spentOn}</td>
                        <td>{x.engagementName}</td>
                        <td>
                          <strong>{x.description}</strong>
                          <div className="small muted">{x.category}{x.rebillable ? '' : ' · not rebilled'}{x.invoiced ? ' · billed' : ''}</div>
                        </td>
                        <td className="num">{kes(x.amount)}</td>
                        <td className="right">
                          <RowMenu label={`Actions for ${x.description}`} items={[{ label: 'Delete', danger: true, hidden: x.invoiced, onSelect: () => remove('expenses', x.id) }]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <SidePanel
        open={panel === 'time'}
        title="Log time"
        onClose={close}
        footer={
          <>
            <button type="button" className="quiet" onClick={close}>Cancel</button>
            <button type="submit" form={TIME_FORM} disabled={busy}>Log time</button>
          </>
        }
      >
        <form id={TIME_FORM} className="stack" onSubmit={addTime}>
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
          {form.engagementId && <label className="row small"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Billable to the client</label>}
          <ErrorNote error={panelError} />
        </form>
      </SidePanel>

      <SidePanel
        open={panel === 'expense'}
        title="Record an expense"
        onClose={close}
        footer={
          <>
            <button type="button" className="quiet" onClick={close}>Cancel</button>
            <button type="submit" form={EXPENSE_FORM} disabled={busy}>Record expense</button>
          </>
        }
      >
        <form id={EXPENSE_FORM} className="stack" onSubmit={addExpense}>
          <p className="muted small">Costs you incurred for the job. They can be added to the client's invoice. Keep the receipt and attach it as evidence on the engagement.</p>
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
          <label className="row small"><input type="checkbox" checked={exp.rebillable} onChange={(e) => setExp({ ...exp, rebillable: e.target.checked })} /> Add to the client's invoice</label>
          <ErrorNote error={panelError} />
        </form>
      </SidePanel>
    </div>
  );
}
