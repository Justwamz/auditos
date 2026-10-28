'use client';
import Link from 'next/link';
import { BillingTabs } from '@/components/BillingTabs';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { ROLE_LABELS } from '@/lib/text';

interface Settings {
  settings: { legalName: string | null; address: string | null; kraPin: string | null; bankDetails: string | null; invoicePrefix: string; quotePrefix: string; paymentTermsDays: number };
  rates: { role: string; rate: string }[];
  taxes: { id: string; name: string; rate: string; onPrevious: boolean; active: boolean }[];
}
const RATE_ROLES = ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'] as const;

export default function BillingSettingsPage() {
  const data = useApi<Settings>('/billing/settings');
  const me = useApi<{ role: string; isAdmin: boolean }>('/me');
  const canEdit = me.data?.role === 'partner' || me.data?.role === 'firm_admin' || me.data?.isAdmin;
  const [form, setForm] = useState({ legalName: '', address: '', kraPin: '', bankDetails: '', invoicePrefix: 'INV', quotePrefix: 'QUO', paymentTermsDays: '30' });
  const [rates, setRates] = useState<Record<string, string>>({});
  const [tax, setTax] = useState({ name: '', rate: '', onPrevious: false });
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  useEffect(() => {
    const d = data.data;
    if (!d) return;
    setForm({
      legalName: d.settings.legalName ?? '', address: d.settings.address ?? '', kraPin: d.settings.kraPin ?? '', bankDetails: d.settings.bankDetails ?? '',
      invoicePrefix: d.settings.invoicePrefix, quotePrefix: d.settings.quotePrefix, paymentTermsDays: String(d.settings.paymentTermsDays),
    });
    setRates(Object.fromEntries(d.rates.map((r) => [r.role, r.rate])));
  }, [data.data]);

  async function run(fn: () => Promise<unknown>, message: string) {
    setError(undefined);
    setDone('');
    try {
      await fn();
      setDone(message);
      data.reload();
    } catch (e) {
      setError(e);
    }
  }

  const saveSettings = (ev: FormEvent) => {
    ev.preventDefault();
    const body: Record<string, unknown> = { invoicePrefix: form.invoicePrefix, quotePrefix: form.quotePrefix, paymentTermsDays: Number(form.paymentTermsDays) };
    for (const k of ['legalName', 'address', 'kraPin', 'bankDetails'] as const) if (form[k].trim()) body[k] = form[k];
    void run(() => api.put('/billing/settings', body), 'Invoice details saved.');
  };
  const saveRates = (ev: FormEvent) => {
    ev.preventDefault();
    const body = Object.fromEntries(Object.entries(rates).filter(([, v]) => v.trim() !== ''));
    void run(() => api.put('/billing/rates', { rates: body }), 'Hourly rates saved. They apply to time logged from now on; earlier entries keep the rate they were logged at.');
  };
  const addTax = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      await api.post('/billing/taxes', { name: tax.name, rate: tax.rate, onPrevious: tax.onPrevious });
      setTax({ name: '', rate: '', onPrevious: false });
    }, 'Tax added to the list. It is only applied to an invoice when someone chooses it there.');
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/billing">Billing</Link></p>
        <div className="row between"><h1>Rates, taxes and settings</h1><HelpLink topic="billing.settings" /></div>
        <p>The firm's hourly rates by role, the taxes that can be put on an invoice, and the details printed on invoices.{canEdit ? '' : ' You can read these; partners and administrators change them.'}</p>
      </div>
      <BillingTabs />
      <ErrorNote error={error ?? data.error} />
      {done && <Notice>{done}</Notice>}

      <form className="sheet stack" onSubmit={saveRates}>
        <h2>Hourly rates (KES)</h2>
        <div className="form-grid">
          {RATE_ROLES.map((r) => (
            <div className="field" key={r}>
              <label htmlFor={`r-${r}`}>{ROLE_LABELS[r] ?? r}</label>
              <input id={`r-${r}`} inputMode="decimal" disabled={!canEdit} value={rates[r] ?? ''} onChange={(e) => setRates({ ...rates, [r]: e.target.value })} placeholder="not set" />
            </div>
          ))}
        </div>
        {canEdit && <div><button>Save rates</button></div>}
      </form>

      <section className="sheet stack">
        <h2>Taxes that can be applied to an invoice</h2>
        <p className="muted">No tax is added to an invoice unless the person making it chooses one, and chooses whether prices include it. Several can be applied, and one can be charged on top of another, for example VAT on top of excise duty.</p>
        <table>
          <thead><tr><th>Tax</th><th>Rate</th><th>Charged</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.data?.taxes.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td><td>{t.rate}%</td><td>{t.onPrevious ? 'on top of the tax before it' : 'on the net amount'}</td><td>{t.active ? 'In use' : 'Switched off'}</td>
                <td>{canEdit && <button className="quiet" onClick={() => run(() => api.patch(`/billing/taxes/${t.id}`, { active: !t.active }), t.active ? 'Tax switched off.' : 'Tax switched on.')}>{t.active ? 'Switch off' : 'Switch on'}</button>}</td>
              </tr>
            ))}
            {data.data?.taxes.length === 0 && <tr><td colSpan={5} className="muted">No taxes yet.</td></tr>}
          </tbody>
        </table>
        {canEdit && (
          <form className="row" onSubmit={addTax}>
            <input aria-label="Tax name" placeholder="Name, for example VAT" required maxLength={60} value={tax.name} onChange={(e) => setTax({ ...tax, name: e.target.value })} />
            <input aria-label="Tax rate in percent" placeholder="Rate %" required inputMode="decimal" style={{ width: '6rem' }} value={tax.rate} onChange={(e) => setTax({ ...tax, rate: e.target.value })} />
            <label className="row small"><input type="checkbox" checked={tax.onPrevious} onChange={(e) => setTax({ ...tax, onPrevious: e.target.checked })} /> Charged on top of the tax before it</label>
            <button className="secondary">Add tax</button>
          </form>
        )}
      </section>

      <form className="sheet stack" onSubmit={saveSettings}>
        <h2>Invoice details</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="sl">Firm name on invoices</label><input id="sl" disabled={!canEdit} maxLength={200} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></div>
          <div className="field"><label htmlFor="sa">Address</label><input id="sa" disabled={!canEdit} maxLength={500} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="field"><label htmlFor="sk">Firm KRA PIN</label><input id="sk" disabled={!canEdit} placeholder="P051234567Q" maxLength={11} value={form.kraPin} onChange={(e) => setForm({ ...form, kraPin: e.target.value })} /></div>
          <div className="field"><label htmlFor="sb">Bank details for payment</label><input id="sb" disabled={!canEdit} maxLength={500} value={form.bankDetails} onChange={(e) => setForm({ ...form, bankDetails: e.target.value })} /></div>
          <div className="field"><label htmlFor="si">Invoice number prefix</label><input id="si" disabled={!canEdit} maxLength={6} value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label htmlFor="sq">Quotation number prefix</label><input id="sq" disabled={!canEdit} maxLength={6} value={form.quotePrefix} onChange={(e) => setForm({ ...form, quotePrefix: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label htmlFor="sd">Days to pay</label><input id="sd" disabled={!canEdit} inputMode="numeric" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })} /></div>
        </div>
        {canEdit && <div><button>Save invoice details</button></div>}
      </form>
    </div>
  );
}
