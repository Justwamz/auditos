'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import type { Engagement } from '../page';

const BENCHMARKS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'total_assets', label: 'Total assets' },
  { id: 'profit_before_tax', label: 'Profit before tax' },
  { id: 'total_expenses', label: 'Total expenses' },
  { id: 'equity', label: 'Equity' },
] as const;

interface Saved { benchmark: string; amount: string; percent: number; performancePercent?: number; trivialPercent?: number; rationale: string; overall: string; performance: string; trivial: string }

const kes = (v: string) => `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Materiality in three amounts. Recalculating saves a new version of the same paper. */
export function Materiality({ engagement: e, locked }: { engagement: Engagement; locked: boolean }) {
  const list = useApi<{ items: { id: string }[] }>(`/engagements/${e.id}/items?kind=materiality`);
  const paperId = list.data?.items[0]?.id;
  const paper = useApi<{ content: Saved }>(paperId ? `/items/${paperId}` : null);
  // A materiality paper written by hand (notes only) has no calculation yet: the form starts empty and saving adds one.
  const content = paper.data?.content;
  const saved = content && typeof content.overall === 'string' && typeof content.amount === 'string' ? content : undefined;
  const [form, setForm] = useState({ benchmark: 'revenue', amount: '', percent: '1', performancePercent: '75', trivialPercent: '5', rationale: '' });
  const [result, setResult] = useState<{ overall: string; performance: string; trivial: string }>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (!saved) return;
    setForm({
      benchmark: saved.benchmark, amount: saved.amount, percent: String(saved.percent),
      performancePercent: String(saved.performancePercent ?? 75), trivialPercent: String(saved.trivialPercent ?? 5), rationale: saved.rationale,
    });
    setResult({ overall: saved.overall, performance: saved.performance, trivial: saved.trivial });
  }, [saved]);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      const r = await api.put<{ overall: string; performance: string; trivial: string }>(`/engagements/${e.id}/materiality`, {
        benchmark: form.benchmark, amount: form.amount, percent: Number(form.percent), rationale: form.rationale,
        performancePercent: Number(form.performancePercent), trivialPercent: Number(form.trivialPercent),
      });
      setResult(r);
      list.reload();
      paper.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="sheet stack" onSubmit={save}>
      <div className="row between"><h2>Materiality</h2><HelpLink topic="engagement.papers.materiality" label="How to calculate it" /></div>
      <p className="muted">Pick a benchmark, enter its amount for the year and a percentage. The performance and clearly trivial amounts follow from it.</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="mb">Benchmark</label>
          <select id="mb" value={form.benchmark} disabled={locked} onChange={(ev) => setForm({ ...form, benchmark: ev.target.value })}>
            {BENCHMARKS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="ma">Benchmark amount (KES)</label><input id="ma" required inputMode="decimal" value={form.amount} disabled={locked} onChange={(ev) => setForm({ ...form, amount: ev.target.value })} /></div>
        <div className="field"><label htmlFor="mp">Percentage of benchmark</label><input id="mp" required inputMode="decimal" value={form.percent} disabled={locked} onChange={(ev) => setForm({ ...form, percent: ev.target.value })} /></div>
        <div className="field"><label htmlFor="mpp">Performance materiality (% of overall)</label><input id="mpp" required inputMode="decimal" value={form.performancePercent} disabled={locked} onChange={(ev) => setForm({ ...form, performancePercent: ev.target.value })} /></div>
        <div className="field"><label htmlFor="mt">Clearly trivial (% of overall)</label><input id="mt" required inputMode="decimal" value={form.trivialPercent} disabled={locked} onChange={(ev) => setForm({ ...form, trivialPercent: ev.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="mr">Why this benchmark and percentage</label><textarea id="mr" required minLength={10} rows={2} value={form.rationale} disabled={locked} onChange={(ev) => setForm({ ...form, rationale: ev.target.value })} /></div>
      <ErrorNote error={error} />
      {result && (
        <Notice>
          Overall materiality <strong>{kes(result.overall)}</strong> · performance materiality <strong>{kes(result.performance)}</strong> · clearly trivial <strong>{kes(result.trivial)}</strong>
        </Notice>
      )}
      {!locked && <div><button className="secondary">{saved ? 'Recalculate and save' : 'Calculate and save'}</button></div>}
    </form>
  );
}
