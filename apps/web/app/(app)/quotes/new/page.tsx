'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { blankLine, LinesEditor, TaxPicker, type LineInput } from '@/components/billing';

export default function NewQuotePage() {
  const router = useRouter();
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const prospects = useApi<{ prospects: { id: string; name: string; stage: string }[] }>('/prospects');
  const [kind, setKind] = useState<'client' | 'prospect'>('client');
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<LineInput[]>([blankLine()]);
  const [tax, setTax] = useState<{ taxIds: string[]; mode: 'exclusive' | 'inclusive' }>({ taxIds: [], mode: 'exclusive' });
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>();

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      const r = await api.post<{ id: string }>('/quotes', {
        ...(kind === 'client' ? { clientId: subject } : { prospectId: subject }), title, taxMode: tax.mode, taxIds: tax.taxIds,
        ...(validUntil ? { validUntil } : {}), ...(notes.trim() ? { notes } : {}), lines: lines.filter((l) => l.description.trim() !== '' || l.unitPrice.trim() !== ''),
      });
      router.push(`/quotes/${r.id}`);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/quotes">Quotations</Link></p>
        <div className="row between"><h1>New quotation</h1><HelpLink topic="quotes" /></div>
      </div>
      <form className="stack-lg" onSubmit={save}>
        <section className="sheet stack">
          <div className="row">
            <label className="row"><input type="radio" name="kind" checked={kind === 'client'} onChange={() => { setKind('client'); setSubject(''); }} /> For a client</label>
            <label className="row"><input type="radio" name="kind" checked={kind === 'prospect'} onChange={() => { setKind('prospect'); setSubject(''); }} /> For a prospect</label>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="qs">{kind === 'client' ? 'Client' : 'Prospect'}</label>
              <select id="qs" required value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Choose</option>
                {kind === 'client' ? clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : prospects.data?.prospects.filter((p) => p.stage !== 'won' && p.stage !== 'lost').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="qt">Title</label><input id="qt" required maxLength={200} placeholder="Statutory audit, year ending 31 December 2026" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label htmlFor="qv">Valid until</label><input id="qv" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
          </div>
        </section>
        <section className="sheet stack"><h2>Lines</h2><LinesEditor lines={lines} onChange={setLines} /></section>
        <section className="sheet stack">
          <TaxPicker taxIds={tax.taxIds} mode={tax.mode} onChange={setTax} />
          <div className="field"><label htmlFor="qn">Notes</label><textarea id="qn" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </section>
        <ErrorNote error={error} />
        <div><button>Save as draft</button></div>
      </form>
    </div>
  );
}
