'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';

export interface RoadmapStep {
  id: string;
  title: string;
  detail: string;
  status: 'done' | 'current' | 'todo';
  tab: 'overview' | 'papers' | 'evidence' | 'checklists' | 'financials';
  action: string;
}
interface RoadmapData { steps: RoadmapStep[]; next: RoadmapStep | null; percent: number }

const MARK = { done: '✓', current: '●', todo: '○' } as const;

/** The audit in the order the firm does it, with one clear next step. */
export function Roadmap({ engagementId, locked, onGo, refreshKey }: { engagementId: string; locked: boolean; onGo: (tab: string) => void; refreshKey?: unknown }) {
  const road = useApi<RoadmapData>(`/engagements/${engagementId}/roadmap?k=${String(refreshKey ?? '')}`);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  if (road.error) return <ErrorNote error={road.error} />;
  if (!road.data) return <p className="muted">Loading the audit roadmap…</p>;
  const { steps, next, percent } = road.data;

  async function go(step: RoadmapStep) {
    setError(undefined);
    if (step.action === 'Start the checklists') {
      setBusy(true);
      try {
        await api.post(`/engagements/${engagementId}/checklists/generate`, {});
        road.reload();
        onGo('checklists');
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
      return;
    }
    onGo(step.tab);
  }

  return (
    <section className="sheet stack roadmap" aria-label="Audit roadmap">
      <div className="row between">
        <h2>Audit roadmap</h2>
        <span className="small muted">{percent}% of the steps done</span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Audit progress"><span style={{ width: `${percent}%` }} /></div>
      <ErrorNote error={error} />
      {next && (
        <div className="next-step">
          <div className="small muted">Your next step</div>
          <h3>{next.title}</h3>
          <p>{next.detail}</p>
          {!locked && <button onClick={() => go(next)} disabled={busy}>{next.action}</button>}
        </div>
      )}
      {!next && <p className="notice ok">Every step is done.</p>}
      <ol className="roadmap-steps">
        {steps.map((s) => (
          <li key={s.id} className={s.status} aria-current={s.status === 'current' ? 'step' : undefined}>
            <span className="mark" aria-hidden="true">{MARK[s.status]}</span>
            <span><strong>{s.title}</strong><span className="sr-only"> ({s.status})</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
