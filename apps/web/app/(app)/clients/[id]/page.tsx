'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice, StateBadge } from '@/components/bits';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { SidePanel } from '@/components/ui/SidePanel';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';

/** Partners and administrators can change who is accountable for the client. The old manager loses sight of it. */
function ChangeManager({ clientId, currentId, onDone, onClose }: { clientId: string; currentId: string | null; onDone: (message: string) => void; onClose: () => void }) {
  const people = useApi<{ people: { id: string; fullName: string | null; email: string; role: string }[] }>('/people');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  async function go(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api.post(`/clients/${clientId}/account-manager`, { userId: to, reason });
      onDone('The account manager was changed and the change recorded.');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <SidePanel
      open
      title="Change the account manager"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="change-manager-form" disabled={busy}>Change</button>
        </>
      }
    >
      <form id="change-manager-form" className="stack" onSubmit={go}>
        <p className="muted">The new manager gets the client; the previous one no longer sees it unless they are on an engagement team. You must give a reason.</p>
        <div className="field">
          <label htmlFor="nm">New account manager</label>
          <select id="nm" required value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a manager or partner</option>
            {people.data?.people.filter((p) => (p.role === 'manager' || p.role === 'partner') && p.id !== currentId).map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nr">Reason for the change</label>
          <input id="nr" placeholder="Why? (recorded)" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <ErrorNote error={error} />
      </form>
    </SidePanel>
  );
}

interface Client {
  id: string; name: string; sector: string; legalForm: string; framework: string; yearEndMonth: number;
  accountManagerName: string | null;
  accountManagerId: string | null;
  engagements: { id: string; periodStart: string; periodEnd: string; state: string }[];
}
type Field = 'phone' | 'email' | 'idNumber' | 'kraPin';
interface Contact { id: string; name: string; position: string | null; phone: string | null; email: string | null; idNumber: string | null; kraPin: string | null }

const FIELDS: { key: Field; label: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'idNumber', label: 'ID number' },
  { key: 'kraPin', label: 'KRA PIN' },
];
const SHOW_SECONDS = 30;

/** One masked value. Revealing asks for a reason, is logged, and hides the value again after thirty seconds. */
function Detail({ clientId, contact, field, masked }: { clientId: string; contact: Contact; field: Field; masked: string | null }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [value, setValue] = useState<string>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (value === undefined) return;
    const t = setTimeout(() => setValue(undefined), SHOW_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [value]);

  if (!masked) return <span className="muted">Not recorded</span>;

  async function reveal(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      const r = await api.post<{ value: string }>(`/clients/${clientId}/contacts/${contact.id}/reveal`, { field, reason });
      setValue(r.value);
      setAsking(false);
      setReason('');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div>
      <span className={value ? 'secret' : ''} aria-live="polite">{value ?? masked}</span>{' '}
      {value ? <span className="small muted">Hidden again in {SHOW_SECONDS} seconds.</span> : !asking && <button className="quiet" onClick={() => setAsking(true)}>Reveal</button>}
      {asking && (
        <form className="row" onSubmit={reveal} style={{ marginTop: '0.3rem' }}>
          <input
            aria-label={`Reason for revealing the ${field} of ${contact.name}`} placeholder="Why do you need this? It is recorded."
            required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} style={{ maxWidth: '22rem' }}
          />
          <button className="secondary">Show details (this is recorded)</button>
          <button type="button" className="quiet" onClick={() => setAsking(false)}>Cancel</button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

const BLANK_CONTACT = { name: '', position: '', phone: '', email: '', idNumber: '', kraPin: '' };

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const client = useApi<Client>(`/clients/${id}`);
  const contacts = useApi<{ contacts: Contact[] }>(`/clients/${id}/contacts`);
  const me = useApi<{ role: string; isAdmin: boolean }>('/me');
  const [form, setForm] = useState(BLANK_CONTACT);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'manager' | 'contact' | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setPanel(null);
    setError(undefined);
    setBusy(false);
  }

  async function add(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setBusy(true);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      await api.post(`/clients/${id}/contacts`, body);
      setNotice(`${form.name} added. Their details are stored encrypted and shown masked.`);
      setForm(BLANK_CONTACT);
      setPanel(null);
      setBusy(false);
      contacts.reload();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  if (client.error) return <ErrorNote error={client.error} />;
  if (!client.data) {
    return (
      <section className="sheet prospects-loading" aria-label="Loading client">
        <Skeleton height={32} width="40%" />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </section>
    );
  }
  const c = client.data;
  const canChange = !!me.data && (me.data.role === 'partner' || me.data.isAdmin || me.data.role === 'firm_admin');

  return (
    <div className="stack-lg">
      <p className="small"><Link href="/clients">All clients</Link></p>
      <PageHead
        title={c.name}
        sentence={`${SECTOR_LABELS[c.sector] ?? c.sector} · ${c.legalForm} · ${c.framework === 'IFRS_SME' ? 'IFRS for SMEs' : 'Full IFRS'} · account manager ${c.accountManagerName ?? 'not set'}`}
        action={
          <>
            {canChange && <button type="button" className="secondary" onClick={() => { setNotice(''); setPanel('manager'); }}>Change the account manager</button>}
            <button type="button" onClick={() => { setNotice(''); setPanel('contact'); }}>Add a contact</button>
          </>
        }
        help={<HelpLink topic="clients.contacts" />}
      />
      {notice && <Notice>{notice}</Notice>}

      <section className="sheet">
        <h2>Engagements you can open</h2>
        {c.engagements.length === 0 && (
          <EmptyState kind="folder">None that you are a member of.</EmptyState>
        )}
        <ul className="item-list">
          {c.engagements.map((e) => (
            <li key={e.id} className="row between">
              <Link href={`/engagements/${e.id}`}>Year ended {fmtDate(e.periodEnd)}</Link>
              <StateBadge state={e.state} />
            </li>
          ))}
        </ul>
      </section>

      <section className="sheet stack">
        <h2>People at the client</h2>
        <p className="muted">Phone numbers, emails, ID numbers and KRA PINs are hidden by default. Revealing one needs a reason, and every reveal is recorded in the activity history.</p>
        <ErrorNote error={contacts.error} />
        {contacts.data?.contacts.length === 0 && (
          <EmptyState kind="people" title="No contacts yet">
            Add the finance contact so the team knows who to call.
          </EmptyState>
        )}
        {contacts.data && contacts.data.contacts.length > 0 && (
          <div className="prospects-scroll">
            <table className="prospects-table">
              <thead><tr><th>Name</th>{FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {contacts.data.contacts.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{p.position && <div className="small muted">{p.position}</div>}</td>
                    {FIELDS.map((f) => <td key={f.key}><Detail clientId={c.id} contact={p} field={f.key} masked={p[f.key]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {panel === 'manager' && canChange && (
        <ChangeManager
          clientId={c.id}
          currentId={c.accountManagerId}
          onClose={close}
          onDone={(message) => {
            close();
            setNotice(message);
            client.reload();
          }}
        />
      )}

      <SidePanel
        open={panel === 'contact'}
        title="Add a contact"
        onClose={close}
        footer={
          <>
            <button type="button" className="quiet" onClick={close}>Cancel</button>
            <button type="submit" form="add-contact-form" disabled={busy}>Add contact</button>
          </>
        }
      >
        <form id="add-contact-form" className="stack" onSubmit={add}>
          <div className="field"><label htmlFor="pn">Full name</label><input id="pn" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="pp">Position</label><input id="pp" maxLength={120} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
          <div className="field"><label htmlFor="ph">Phone</label><input id="ph" inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label htmlFor="pe">Email</label><input id="pe" type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="pi">ID number</label><input id="pi" maxLength={20} value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} /></div>
          <div className="field"><label htmlFor="pk">KRA PIN</label><input id="pk" placeholder="A012345678B" maxLength={11} value={form.kraPin} onChange={(e) => setForm({ ...form, kraPin: e.target.value })} /></div>
          <ErrorNote error={error} />
        </form>
      </SidePanel>
    </div>
  );
}
