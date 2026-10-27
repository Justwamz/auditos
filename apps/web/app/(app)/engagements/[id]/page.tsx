'use client';
import { Suspense } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { ErrorNote, StateBadge } from '@/components/bits';
import type { Viewer } from '@/components/ItemPanel';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';
import { Overview } from './tabs/Overview';
import { Papers } from './tabs/Papers';
import { Checklists } from './tabs/Checklists';
import { Evidence } from './tabs/Evidence';
import { Financials } from './tabs/Financials';

export interface Engagement {
  id: string;
  clientName: string;
  sector: string;
  framework: string;
  periodStart: string;
  periodEnd: string;
  state: string;
  partnerId: string;
  eqrId: string | null;
  reportDate: string | null;
  riskFlags: string[];
}
export interface Me { userId: string; email: string; role: string }

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'papers', label: 'Working papers' },
  { id: 'checklists', label: 'Checklists' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'financials', label: 'Financial statements' },
] as const;

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const eng = useApi<Engagement>(`/engagements/${id}`);
  const me = useApi<Me>('/me');
  const tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as (typeof TABS)[number]['id']) : 'overview';

  const setTab = (t: string) => router.replace(`${path}?tab=${t}`);

  if (eng.error) return <ErrorNote error={eng.error} />;
  if (!eng.data || !me.data) return <p className="muted">Loading engagement…</p>;
  const e = eng.data;
  const viewer: Viewer = { userId: me.data.userId, role: me.data.role, engagementLocked: e.state === 'locked' };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row between">
          <h1>{e.clientName}</h1>
          <StateBadge state={e.state} />
        </div>
        <p>
          {SECTOR_LABELS[e.sector] ?? e.sector} · year ended {fmtDate(e.periodEnd)} · {e.framework === 'IFRS_SME' ? 'IFRS for SMEs' : 'Full IFRS'}
        </p>
      </div>

      <div className="tabs" role="tablist" aria-label="Engagement sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview engagement={e} me={me.data} onChanged={eng.reload} onGo={setTab} />}
      {tab === 'papers' && <Papers engagement={e} viewer={viewer} focusItem={params.get('item')} />}
      {tab === 'checklists' && <Checklists engagement={e} viewer={viewer} />}
      {tab === 'evidence' && <Evidence engagement={e} viewer={viewer} />}
      {tab === 'financials' && <Financials engagement={e} viewer={viewer} onChanged={eng.reload} />}
    </div>
  );
}

export default function EngagementPage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
