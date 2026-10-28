'use client';
import { Suspense } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { ErrorNote, StateBadge } from '@/components/bits';
import type { Viewer } from '@/components/ItemPanel';
import { PageHead } from '@/components/ui/PageHead';
import { Skeleton } from '@/components/ui/EmptyState';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';
import { Overview } from './tabs/Overview';
import { Papers } from './tabs/Papers';
import { Checklists } from './tabs/Checklists';
import { Evidence } from './tabs/Evidence';
import { Financials } from './tabs/Financials';
import { BankStatements } from './tabs/BankStatements';
import { Sampling } from './tabs/Sampling';

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
  /** On the engagement team. A partner who is not can read but not change. */
  member: boolean;
}
export interface Me { userId: string; email: string; role: string }

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'papers', label: 'Working papers' },
  { id: 'checklists', label: 'Checklists' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'financials', label: 'Financial statements' },
  { id: 'bank', label: 'Bank statements' },
  { id: 'sampling', label: 'Sampling' },
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
  if (!eng.data || !me.data) return (
    <section className="sheet prospects-loading" aria-label="Loading engagement">
      <Skeleton height={36} width="40%" />
      <Skeleton height={48} />
      <Skeleton height={48} />
    </section>
  );
  const e = eng.data;
  const viewer: Viewer = { userId: me.data.userId, role: me.data.role, engagementLocked: e.state === 'locked' || !e.member };

  return (
    <div className="stack">
      <PageHead
        title={e.clientName}
        sentence={`${SECTOR_LABELS[e.sector] ?? e.sector} · year ended ${fmtDate(e.periodEnd)} · ${e.framework === 'IFRS_SME' ? 'IFRS for SMEs' : 'Full IFRS'}`}
        help={<StateBadge state={e.state} />}
      />

      {!e.member && (
        <div className="notice warn" role="status">
          You are viewing this engagement as a partner. You are not on its team, so you can read everything but cannot change anything. Ask the manager to add you if you need to work on it. Your viewing is recorded in the activity history.
        </div>
      )}

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
      {tab === 'bank' && <BankStatements engagement={e} viewer={viewer} />}
      {tab === 'sampling' && <Sampling engagement={e} viewer={viewer} />}
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
