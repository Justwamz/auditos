'use client';
import { useState, type FormEvent } from 'react';
import { QualityTabs } from '@/components/QualityTabs';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { fmtDate } from '@/lib/text';

interface Decl { id: string; engagementId: string | null; declaredAt: string; expiresAt: string }

export default function IndependencePage() {
  const list = useApi<{ declarations: Decl[] }>('/independence');
  const [statement, setStatement] = useState('I have no financial, family, employment or other relationships with the firm’s clients that would impair my independence.');
  const [threat, setThreat] = useState('');
  const [safeguard, setSafeguard] = useState('');
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone(false);
    try {
      await api.post('/independence', { statement, threats: threat ? [{ threat, safeguard }] : [] });
      setDone(true);
      list.reload();
    } catch (e) {
      setError(e);
    }
  }
  const current = list.data?.declarations.find((d) => !d.engagementId && new Date(d.expiresAt) > new Date());

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Independence</h1>
        <p>You need a current declaration before you can be assigned to an engagement. Declarations last twelve months.</p>
      </div>
      <QualityTabs />
      <ErrorNote error={list.error} />
      {current ? <Notice>Your annual declaration is current until {fmtDate(current.expiresAt)}.</Notice> : list.data && <Notice kind="warn">You have no current annual declaration.</Notice>}

      <form className="sheet stack" onSubmit={submit}>
        <h2>Declare independence</h2>
        <div className="field"><label htmlFor="st">Declaration</label><textarea id="st" required minLength={10} value={statement} onChange={(e) => setStatement(e.target.value)} /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="th">Threat identified <span className="hint">optional</span></label><input id="th" value={threat} onChange={(e) => setThreat(e.target.value)} /></div>
          <div className="field"><label htmlFor="sf">Safeguard applied</label><input id="sf" value={safeguard} onChange={(e) => setSafeguard(e.target.value)} /></div>
        </div>
        <ErrorNote error={error} />
        {done && <Notice>Declaration recorded.</Notice>}
        <div><button>Submit declaration</button></div>
      </form>

      <section className="sheet">
        <h2>Your declarations</h2>
        {list.data && list.data.declarations.length === 0 && <Empty>None yet.</Empty>}
        {list.data && list.data.declarations.length > 0 && (
          <table>
            <thead><tr><th>Declared</th><th>Valid until</th><th>Applies to</th></tr></thead>
            <tbody>{list.data.declarations.map((d) => <tr key={d.id}><td>{fmtDate(d.declaredAt)}</td><td>{fmtDate(d.expiresAt)}</td><td>{d.engagementId ? 'One engagement' : 'All engagements'}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
