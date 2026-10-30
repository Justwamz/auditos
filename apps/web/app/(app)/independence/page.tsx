'use client';
import { useState, type FormEvent } from 'react';
import { QualityTabs } from '@/components/QualityTabs';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { SidePanel } from '@/components/ui/SidePanel';
import { fmtDate } from '@/lib/text';
import { TableScroll } from '@/components/ui/TableScroll';

interface Decl { id: string; engagementId: string | null; declaredAt: string; expiresAt: string }

const FORM = 'declaration-form';
const STATEMENT = 'I have no financial, family, employment or other relationships with the firm’s clients that would impair my independence.';

export default function IndependencePage() {
  const list = useApi<{ declarations: Decl[] }>('/independence');
  const [statement, setStatement] = useState(STATEMENT);
  const [threat, setThreat] = useState('');
  const [safeguard, setSafeguard] = useState('');
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState(false);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    setPanel(false);
    setError(undefined);
    setBusy(false);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api.post('/independence', { statement, threats: threat ? [{ threat, safeguard }] : [] });
      setDone(true);
      setStatement(STATEMENT);
      setThreat('');
      setSafeguard('');
      setPanel(false);
      setBusy(false);
      list.reload();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  const current = list.data?.declarations.find((d) => !d.engagementId && new Date(d.expiresAt) > new Date());
  const rows = list.data?.declarations ?? [];
  const loading = list.loading && !list.data;

  return (
    <div className="stack-lg">
      <PageHead
        title="Independence"
        sentence="You need a current declaration before you can be assigned to an engagement. Declarations last twelve months."
        action={<button type="button" onClick={() => { setDone(false); setPanel(true); }}>+ Make a declaration</button>}
      />
      <QualityTabs />
      <ErrorNote error={list.error} />
      {done && <Notice>Declaration recorded.</Notice>}
      {current ? <Notice>Your annual declaration is current until {fmtDate(current.expiresAt)}.</Notice> : list.data && <Notice kind="warn">You have no current annual declaration.</Notice>}

      {loading && (
        <section className="sheet prospects-loading" aria-label="Loading declarations">
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {list.data && rows.length === 0 && (
        <section className="sheet">
          <EmptyState kind="ledger" title="No declarations yet">Use Make a declaration at the top to record your first one.</EmptyState>
        </section>
      )}

      {rows.length > 0 && (
        <section className="sheet prospects-sheet">
          <TableScroll label="Your declarations list">
            <table className="prospects-table" aria-label="Your declarations">
              <thead><tr><th>Declared</th><th>Valid until</th><th>Applies to</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{fmtDate(d.declaredAt)}</td>
                    <td className="nowrap">{fmtDate(d.expiresAt)}</td>
                    <td>{d.engagementId ? 'One engagement' : 'All engagements'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </section>
      )}

      <SidePanel
        open={panel}
        title="Make a declaration"
        onClose={close}
        footer={
          <>
            <button type="button" className="quiet" onClick={close}>Cancel</button>
            <button type="submit" form={FORM} disabled={busy}>Submit declaration</button>
          </>
        }
      >
        <form id={FORM} className="stack" onSubmit={submit}>
          <div className="field"><label htmlFor="st">Declaration</label><textarea id="st" required minLength={10} value={statement} onChange={(e) => setStatement(e.target.value)} /></div>
          <div className="field"><label htmlFor="th">Threat identified <span className="hint">optional</span></label><input id="th" value={threat} onChange={(e) => setThreat(e.target.value)} /></div>
          <div className="field"><label htmlFor="sf">Safeguard applied</label><input id="sf" value={safeguard} onChange={(e) => setSafeguard(e.target.value)} /></div>
          <ErrorNote error={error} />
        </form>
      </SidePanel>
    </div>
  );
}
