'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { usePref } from '@/lib/prefs';
import { countByStage, filterProspects, STAGE_LABELS, type Prospect, type ProspectActions, type Stage } from '@/lib/pipeline';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { ProspectCards } from '@/components/ProspectCards';
import { ProspectPanel, type PanelMode, type Person } from '@/components/ProspectPanel';
import { ProspectTable, StagePill } from '@/components/ProspectTable';
import { Chips } from '@/components/ui/Chips';
import { Disclosure } from '@/components/ui/Disclosure';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { Segmented } from '@/components/ui/Segmented';

interface Summary { byStage: Record<string, { count: number; value: string }>; byOwner: { ownerId: string; ownerName: string; count: number; value: string }[] }
type StageFilter = 'open' | 'lead' | 'proposal' | 'loe_sent';

export default function PipelinePage() {
  const data = useApi<{ prospects: Prospect[]; summary: Summary }>('/prospects');
  const me = useApi<{ userId: string; role: string }>('/me');
  const people = useApi<{ people: Person[] }>('/people');
  const [view, setView] = usePref<'table' | 'cards'>('pipeline.view', 'table');
  const [stage, setStage] = useState<StageFilter>('open');
  const [ownerId, setOwnerId] = useState('');
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<{ mode: PanelMode; prospect?: Prospect } | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState<unknown>();
  const manager = me.data?.role === 'manager' || me.data?.role === 'partner';

  const all = useMemo(() => data.data?.prospects ?? [], [data.data]);
  const summary = data.data?.summary;
  const owners = useMemo(() => [...new Map(all.map((p) => [p.ownerId, p.ownerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all]);

  // Counts follow the person and search filters, so the chips always match what the table can show.
  const scoped = useMemo(
    () => (['open', 'won', 'lost'] as const).flatMap((s) => filterProspects(all, { stage: s, ownerId, query })),
    [all, ownerId, query],
  );
  const counts = countByStage(scoped);
  const rows = useMemo(() => filterProspects(all, { stage, ownerId, query }), [all, stage, ownerId, query]);
  const closed = useMemo(() => [...filterProspects(all, { stage: 'won', ownerId, query }), ...filterProspects(all, { stage: 'lost', ownerId, query })], [all, ownerId, query]);
  const filtered = ownerId !== '' || query.trim() !== '';
  const totals = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of ['lead', 'proposal', 'loe_sent'] as const) {
      out[s] = filtered
        ? String(scoped.filter((p) => p.stage === s).reduce((sum, p) => sum + Number(p.expectedFee ?? 0), 0))
        : summary?.byStage[s]?.value ?? '0';
    }
    return out;
  }, [filtered, scoped, summary]);

  async function move(p: Prospect, to: Stage) {
    setActionError(undefined);
    setNotice('');
    try {
      await api.post(`/prospects/${p.id}/stage`, { stage: to });
      setNotice(`${p.name} moved to ${STAGE_LABELS[to]}.`);
      data.reload();
    } catch (e) {
      setActionError(e);
    }
  }
  const actions: ProspectActions = {
    move: (p, to) => void move(p, to),
    lose: (p) => setPanel({ mode: 'lost', prospect: p }),
    handOver: (p) => setPanel({ mode: 'handover', prospect: p }),
    convert: (p) => setPanel({ mode: 'convert', prospect: p }),
  };

  const options = [
    { id: 'open', label: 'All open', count: counts.lead + counts.proposal + counts.loe_sent },
    { id: 'lead', label: STAGE_LABELS.lead, count: counts.lead },
    { id: 'proposal', label: STAGE_LABELS.proposal, count: counts.proposal },
    { id: 'loe_sent', label: STAGE_LABELS.loe_sent, count: counts.loe_sent },
  ];

  const addButton = <button type="button" onClick={() => setPanel({ mode: 'add' })}>+ Add a prospect</button>;
  const loading = data.loading && !data.data;
  const noneAtAll = !!data.data && all.length === 0;

  return (
    <div className="stack-lg">
      <PageHead
        title="Prospects"
        sentence={`Prospective clients, from first contact to signed engagement letter. ${manager ? 'You see all of them.' : 'You see the prospects you own.'}`}
        action={addButton}
        help={<HelpLink topic="pipeline" />}
      />
      <ErrorNote error={data.error} />
      <ErrorNote error={actionError} />
      {notice && <Notice>{notice}</Notice>}

      {loading && (
        <section className="sheet prospects-loading" aria-label="Loading prospects">
          <Skeleton height={36} width="60%" />
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {noneAtAll && (
        <section className="sheet">
          <EmptyState kind="people" title="No prospects yet" action={addButton}>
            Add the first person or business you hope to work with, and keep track of it here.
          </EmptyState>
        </section>
      )}

      {data.data && !noneAtAll && (
        <>
          <div className="prospects-toolbar">
            <Chips label="Show prospects at" value={stage} onChange={(id) => setStage(id as StageFilter)} options={options} />
            <span className="small muted prospects-closed-counts">Won {counts.won} · Lost {counts.lost}</span>
          </div>
          <div className="prospects-toolbar">
            <div className="row">
              <input type="search" className="prospects-search" aria-label="Search prospects" placeholder="Search by prospect or owner" value={query} onChange={(e) => setQuery(e.target.value)} />
              {manager && (
                <select className="prospects-person" aria-label="Show prospects of" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">Everyone</option>
                  {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
            </div>
            <Segmented label="How to show the list" value={view} onChange={(id) => setView(id as 'table' | 'cards')} options={[{ id: 'table', label: 'Table' }, { id: 'cards', label: 'Cards' }]} />
          </div>

          {rows.length === 0 ? (
            <section className="sheet">
              <EmptyState kind="folder" title="No prospects match" action={<button type="button" className="secondary" onClick={() => { setStage('open'); setOwnerId(''); setQuery(''); }}>Show everything</button>}>
                Try a different word, person or stage.
              </EmptyState>
            </section>
          ) : view === 'table' ? (
            <section className="sheet prospects-sheet"><ProspectTable rows={rows} actions={actions} manager={!!manager} /></section>
          ) : (
            <ProspectCards rows={rows} actions={actions} manager={!!manager} totals={totals} />
          )}

          {closed.length > 0 && (
            <section className="sheet">
              <Disclosure summary={<span>Closed <span className="muted small">({closed.length})</span></span>}>
                <table className="prospects-table">
                  <thead><tr><th>Prospect</th><th>Outcome</th><th>Owner</th></tr></thead>
                  <tbody>
                    {closed.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td><StagePill stage={p.stage} />{p.stage === 'won' ? ' now a client' : p.lostReason ? ` ${p.lostReason}` : ''}</td>
                        <td>{p.ownerName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Disclosure>
            </section>
          )}
        </>
      )}

      {panel && (
        <ProspectPanel
          key={panel.mode + (panel.prospect?.id ?? '')}
          mode={panel.mode}
          prospect={panel.prospect}
          me={me.data ?? { userId: '', role: '' }}
          people={people.data?.people ?? []}
          onClose={() => setPanel(null)}
          onDone={(message) => {
            setPanel(null);
            setActionError(undefined);
            setNotice(message);
            data.reload();
          }}
        />
      )}
    </div>
  );
}
