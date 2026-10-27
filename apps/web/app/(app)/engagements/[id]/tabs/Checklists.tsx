'use client';
import { useState } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { ItemPanel, type Viewer } from '@/components/ItemPanel';
import type { Engagement } from '../page';

interface Completeness { mandatoryOpen: { checklistId: string; itemId: string; ref: string; question: string }[]; total: number; answered: number; percent: number }
interface Row { id: string; title: string; state: string }
interface CItem { id: string; ref: string; question: string; mandatory: boolean; standardRefs: string[]; response: 'yes' | 'no' | 'na' | null; rationale: string; prior?: { response: 'yes' | 'no' | 'na'; rationale: string } | null }

const ANSWER = { yes: 'Yes', no: 'No', na: 'Not applicable' } as const;

function Question({ checklistId, item, locked, onSaved }: { checklistId: string; item: CItem; locked: boolean; onSaved: () => void }) {
  const [response, setResponse] = useState<CItem['response']>(item.response);
  const [rationale, setRationale] = useState(item.rationale);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const needsWhy = response === 'no' || response === 'na';

  async function save(next: CItem['response'], why = rationale) {
    setError(undefined);
    setSaved(false);
    try {
      await api.patch(`/checklists/${checklistId}/items/${item.id}`, { response: next, rationale: why });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    }
  }

  async function confirmPrior() {
    setError(undefined);
    try {
      await api.post(`/checklists/${checklistId}/items/${item.id}/confirm-prior`, {});
      onSaved();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="question">
      <div>
        <span className="ref">{item.ref}</span> {item.question} {item.mandatory && <span className="mandatory-mark" title="Mandatory">*</span>}
        <div className="small muted">{item.standardRefs.join(', ')}</div>
      </div>
      <div className="options" role="radiogroup" aria-label={`Answer for ${item.ref}`}>
        {(['yes', 'no', 'na'] as const).map((v) => (
          <label key={v}>
            <input
              type="radio" name={`q-${item.id}`} disabled={locked} checked={response === v}
              onChange={() => { setResponse(v); if (v === 'yes') void save('yes', ''); }}
            />
            {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not applicable'}
          </label>
        ))}
      </div>
      {item.prior && item.response === null && !locked && (
        <div className="prior">
          <span>Last year: <strong>{ANSWER[item.prior.response]}</strong>{item.prior.rationale ? ` (${item.prior.rationale})` : ''}</span>
          <button className="secondary" onClick={() => confirmPrior()}>Same as last year</button>
        </div>
      )}
      {needsWhy && !locked && (
        <div className="row">
          <input aria-label={`Rationale for ${item.ref}`} placeholder="Why? A short rationale is required" value={rationale} onChange={(e) => setRationale(e.target.value)} style={{ maxWidth: '34rem' }} />
          <button className="secondary" onClick={() => save(response)} disabled={rationale.trim().length < 5}>Save answer</button>
        </div>
      )}
      <ErrorNote error={error} />
      {saved && <span className="small muted">Saved.</span>}
    </div>
  );
}

export function Checklists({ engagement: e, viewer }: { engagement: Engagement; viewer: Viewer }) {
  const list = useApi<{ items: Row[] }>(`/engagements/${e.id}/items?kind=checklist`);
  const done = useApi<Completeness>(`/engagements/${e.id}/completeness`);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  async function generate() {
    setError(undefined);
    setInfo('');
    try {
      const r = await api.post<{ created: number; skipped: number; notices: string[] }>(`/engagements/${e.id}/checklists/generate`, {});
      setNotices(r.notices);
      setInfo(r.created === 0 ? 'The checklists were already generated.' : `Added ${r.created} checklists for this client’s sector and risk flags.`);
      list.reload();
      done.reload();
    } catch (err) {
      setError(err);
    }
  }
  const refresh = () => { done.reload(); list.reload(); };

  return (
    <div className="stack-lg">
      <section className="sheet stack">
        <div className="row between">
          <h2>Checklists</h2>
          <HelpLink topic="engagement.checklists" label="How checklists work" />
          {!viewer.engagementLocked && <button onClick={generate}>Generate checklists</button>}
        </div>
        <p className="muted">Built from the client’s sector, framework and risk flags. The content is draft wording until your content owner reviews it. Questions marked * are mandatory.</p>
        <ErrorNote error={error} />
        {info && <Notice>{info}</Notice>}
        {notices.map((n) => <Notice key={n} kind="warn">{n}</Notice>)}
        {done.data && done.data.total > 0 && (
          <div>
            <div className="row between small"><span>{done.data.answered} of {done.data.total} answered</span><span>{done.data.mandatoryOpen.length} mandatory still open</span></div>
            <div className="bar" role="progressbar" aria-valuenow={done.data.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist completeness"><span style={{ width: `${done.data.percent}%` }} /></div>
          </div>
        )}
      </section>

      {list.data && list.data.items.length === 0 && <Empty>No checklists yet. Generate them to start.</Empty>}
      {list.data?.items.map((c) => (
        <div key={c.id}>
          <div className="row between" style={{ marginBottom: '0.4rem' }}>
            <h3>{c.title}</h3>
            <button className="quiet" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Close' : 'Open'}</button>
          </div>
          {open === c.id && (
            <ItemPanel key={c.id} itemId={c.id} viewer={viewer} onChanged={refresh}>
              {(item, reload) => (
                <div>
                  {(item.content.items as CItem[]).map((q) => (
                    <Question key={`${q.id}-${q.response}`} checklistId={item.id} item={q} locked={viewer.engagementLocked} onSaved={reload} />
                  ))}
                </div>
              )}
            </ItemPanel>
          )}
        </div>
      ))}
    </div>
  );
}
