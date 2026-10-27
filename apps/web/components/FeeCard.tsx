'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { kes } from '@/lib/dates';

interface Fee { fee: { basis: 'hourly' | 'flat'; flatFee: string | null; budgetHours: number | null; notes: string | null } | null }

/** How this job is billed: by the hour at the firm's rates, or a fixed fee, with an optional budget of hours. Managers and partners see it. */
export function FeeCard({ engagementId, canEdit }: { engagementId: string; canEdit: boolean }) {
  const fee = useApi<Fee>(`/engagements/${engagementId}/fee`);
  const [form, setForm] = useState({ basis: 'hourly' as 'hourly' | 'flat', flatFee: '', budgetHours: '', notes: '' });
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  useEffect(() => {
    const f = fee.data?.fee;
    if (f) setForm({ basis: f.basis, flatFee: f.flatFee ?? '', budgetHours: f.budgetHours === null ? '' : String(f.budgetHours), notes: f.notes ?? '' });
  }, [fee.data]);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone('');
    try {
      await api.put(`/engagements/${engagementId}/fee`, {
        basis: form.basis,
        ...(form.basis === 'flat' ? { flatFee: form.flatFee } : {}),
        ...(form.budgetHours.trim() ? { budgetHours: Number(form.budgetHours) } : {}),
        ...(form.notes.trim() ? { notes: form.notes } : {}),
      });
      setDone('Fee arrangement saved.');
      fee.reload();
    } catch (e) {
      setError(e);
    }
  }

  if (fee.error) return null;
  const current = fee.data?.fee;
  return (
    <section className="sheet stack" aria-label="Fee arrangement">
      <div className="row between"><h2>How this job is billed</h2><HelpLink topic="billing.fee" label="About fees" /></div>
      <p className="muted">
        {current ? (current.basis === 'flat' ? `Fixed fee of ${kes(current.flatFee)}` : 'By the hour at the firm’s rates') : 'Not set yet.'}
        {current?.budgetHours ? `, budget ${current.budgetHours} hours.` : '.'}
      </p>
      {canEdit && (
        <form className="stack" onSubmit={save}>
          <div className="row">
            <label className="row"><input type="radio" name="basis" checked={form.basis === 'hourly'} onChange={() => setForm({ ...form, basis: 'hourly' })} /> By the hour</label>
            <label className="row"><input type="radio" name="basis" checked={form.basis === 'flat'} onChange={() => setForm({ ...form, basis: 'flat' })} /> Fixed fee</label>
          </div>
          <div className="form-grid">
            {form.basis === 'flat' && <div className="field"><label htmlFor="ff">Fixed fee (KES, before tax)</label><input id="ff" required inputMode="decimal" value={form.flatFee} onChange={(e) => setForm({ ...form, flatFee: e.target.value })} /></div>}
            <div className="field"><label htmlFor="fb">Budget (hours)</label><input id="fb" inputMode="decimal" value={form.budgetHours} onChange={(e) => setForm({ ...form, budgetHours: e.target.value })} /></div>
            <div className="field"><label htmlFor="fn">Note</label><input id="fn" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <ErrorNote error={error} />
          {done && <Notice>{done}</Notice>}
          <div><button className="secondary">Save</button></div>
        </form>
      )}
    </section>
  );
}
