'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_BRAND, type Adjustment } from '@auditos/brand';
import { api } from '@/lib/api';
import { explain } from '@/lib/text';
import { useApi } from '@/lib/hooks';
import { accentView } from '@/lib/branding';
import { canOpenBranding } from '@/lib/nav';
import { Notice } from '@/components/bits';
import { BrandPreview, previewPalette } from '@/components/BrandPreview';
import { FirmTabs } from '@/components/FirmTabs';
import { HelpLink } from '@/components/HelpLink';
import { useMe } from '@/components/Me';
import { PageHead } from '@/components/ui/PageHead';
import { SectionHead } from '@/components/ui/SectionHead';
import { Skeleton } from '@/components/ui/EmptyState';

interface BrandingView {
  branding: {
    primary: string; secondary: string; phone: string | null; email: string | null; website: string | null; footerNote: string | null; logoId: string | null;
    adjustments: Adjustment[];
    firm: { legalName: string | null; address: string | null; kraPin: string | null; bankDetails: string | null };
  };
  canEdit: boolean;
}
interface MeView { activeTenantId: string | null; memberships: { tenantId: string; tenantName: string }[] }

const CODE = /^#[0-9a-fA-F]{6}$/;
const FIELD_NAME = { primary: 'main colour', secondary: 'accent colour' } as const;

function ColourField({ id, label, value, onChange, note }: { id: string; label: string; value: string; onChange: (v: string) => void; note?: string | null }) {
  const valid = CODE.test(value);
  return (
    <div className="field">
      <label htmlFor={`${id}-code`}>{label} code</label>
      <div className="colour-pick">
        <input type="color" aria-label={`${label} picker`} value={valid ? value.toLowerCase() : '#000000'} onChange={(e) => onChange(e.target.value)} />
        <input id={`${id}-code`} type="text" value={value} maxLength={7} spellCheck={false} aria-invalid={!valid} aria-describedby={valid ? undefined : `${id}-hint`} onChange={(e) => onChange(e.target.value.trim())} />
      </div>
      {!valid && <p id={`${id}-hint`} className="small muted">Colour codes look like #1a2b3c.</p>}
      {valid && note && <p className="small muted" data-testid={`${id}-note`}>{note}</p>}
    </div>
  );
}

/** What we changed to keep text readable, in words, with the colours before and after (not colour alone). */
function ColourNote({ adjustments }: { adjustments: Adjustment[] }) {
  if (adjustments.length === 0) return null;
  return (
    <div className="notice warn" role="status" data-testid="colour-note">
      <strong>We adjusted a colour so people can read the text.</strong>
      <ul>
        {adjustments.map((a) => (
          <li key={a.field}>
            {a.reason} Your {FIELD_NAME[a.field]}: Before <span className="swatch" style={{ background: a.from }} aria-hidden="true" />{a.from}, After <span className="swatch" style={{ background: a.to }} aria-hidden="true" />{a.to}.
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BrandingPage() {
  const router = useRouter();
  const { role, isAdmin } = useMe();
  const allowed = canOpenBranding(role, isAdmin);
  useEffect(() => {
    if (!allowed) router.replace('/');
  }, [allowed, router]);

  const data = useApi<BrandingView>(allowed ? '/branding' : null);
  const me = useApi<MeView>(allowed ? '/me' : null);
  const [colours, setColours] = useState<{ primary: string; secondary: string }>({ ...DEFAULT_BRAND });
  const [contact, setContact] = useState({ phone: '', email: '', website: '', footerNote: '' });
  const [savedNote, setSavedNote] = useState<Adjustment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  // The form is filled from the server once. Later reloads (after an upload, a removal or a reset) refresh the saved
  // copy and the logo only, so nothing typed and not yet saved is lost.
  const seeded = useRef(false);
  useEffect(() => {
    const b = data.data?.branding;
    if (!b || seeded.current) return;
    seeded.current = true;
    setColours({ primary: b.primary, secondary: b.secondary });
    setContact({ phone: b.phone ?? '', email: b.email ?? '', website: b.website ?? '', footerNote: b.footerNote ?? '' });
  }, [data.data]);

  if (!allowed) return null;

  const b = data.data?.branding;
  const firmName = b?.firm.legalName ?? me.data?.memberships.find((m) => m.tenantId === me.data?.activeTenantId)?.tenantName ?? 'Your firm';
  const derived = previewPalette(colours.primary, colours.secondary);
  const accent = accentView(colours.primary, colours.secondary);
  const liveNote = derived?.adjustments ?? [];
  const note = liveNote.length > 0 ? liveNote : savedNote;
  const bothValid = CODE.test(colours.primary) && CODE.test(colours.secondary);

  /** Every action shows at most one message: what went wrong, or what was done. */
  async function run(fn: () => Promise<void>, message: string) {
    setProblem('');
    setDone('');
    setBusy(true);
    try {
      await fn();
      setDone(message);
      data.reload();
      router.refresh(); // so the menu picks up the new colours and logo straight away
    } catch (e) {
      setProblem(explain(e));
    } finally {
      setBusy(false);
    }
  }

  const pick = (field: 'primary' | 'secondary') => (v: string) => {
    setSavedNote([]);
    setColours((c) => ({ ...c, [field]: v }));
  };

  const save = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api.put<BrandingView>('/branding', { ...colours, phone: contact.phone, email: contact.email, website: contact.website, footerNote: contact.footerNote });
      setColours({ primary: r.branding.primary, secondary: r.branding.secondary });
      setSavedNote(r.branding.adjustments);
    }, 'Branding saved.');
  };

  const reset = () =>
    run(async () => {
      await api.put('/branding', { primary: DEFAULT_BRAND.primary, secondary: DEFAULT_BRAND.secondary });
      setColours({ ...DEFAULT_BRAND });
      setSavedNote([]);
    }, 'Back to the AuditOS colours.');

  const upload = () => {
    if (!file) {
      setDone('');
      setProblem('Choose a PNG or JPG file first.');
      return;
    }
    void run(async () => {
      const form = new FormData();
      form.append('file', file);
      await api.upload('/branding/logo', form);
      setFile(null);
    }, 'Logo saved.');
  };

  const removeLogo = () => run(async () => { await api.del('/branding/logo'); }, 'Logo removed.');

  return (
    <div className="stack-lg">
      <PageHead
        title="Branding"
        sentence="Your logo, contact details and colours, shown across AuditOS and on your quotes and invoices."
        help={<HelpLink topic="branding" />}
      />
      <FirmTabs />
      {(problem || Boolean(data.error)) && <div className="notice error" role="alert">{problem || explain(data.error)}</div>}
      {done && <Notice>{done}</Notice>}
      {!b && !data.error && <Skeleton />}

      {b && (
        <form className="stack-lg" onSubmit={save}>
          <section className="sheet stack">
            <SectionHead title="Logo" sentence="A PNG or JPG picture, up to 1 MB. It shows on a white plate in the menu and at the top of invoices. A new logo is saved as soon as you upload it." />
            <div className="row">
              {b.logoId ? <img src={`/api/branding/logo/${b.logoId}`} alt="Your firm logo" height={48} style={{ maxWidth: '12rem', objectFit: 'contain' }} /> : <p className="muted">No logo yet.</p>}
            </div>
            <div className="row">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="logo-file">Logo file (PNG or JPG)</label>
                <input id="logo-file" type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <button type="button" className="secondary" disabled={busy} onClick={upload}>{b.logoId ? 'Replace logo' : 'Upload logo'}</button>
              {b.logoId && <button type="button" className="quiet" disabled={busy} onClick={removeLogo}>Remove logo</button>}
            </div>
          </section>

          <section className="sheet stack">
            <SectionHead title="Contact details" sentence="These print under your firm name on quotes and invoices. Leave a box empty to leave it out." />
            <div className="form-grid">
              <div className="field"><label htmlFor="b-phone">Phone</label><input id="b-phone" maxLength={30} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></div>
              <div className="field"><label htmlFor="b-email">Email</label><input id="b-email" type="email" maxLength={254} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></div>
              <div className="field"><label htmlFor="b-web">Website</label><input id="b-web" placeholder="https://" maxLength={300} value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="b-foot">Footer note</label><textarea id="b-foot" rows={2} maxLength={300} value={contact.footerNote} onChange={(e) => setContact({ ...contact, footerNote: e.target.value })} /></div>
            <h3>Printed with these</h3>
            <dl className="fixed-details">
              <div><dt>Firm name on invoices</dt><dd>{b.firm.legalName ?? 'Not set yet'}</dd></div>
              <div><dt>Address</dt><dd>{b.firm.address ?? 'Not set yet'}</dd></div>
              <div><dt>KRA PIN</dt><dd>{b.firm.kraPin ?? 'Not set yet'}</dd></div>
              <div><dt>Bank details</dt><dd>{b.firm.bankDetails ?? 'Not set yet'}</dd></div>
            </dl>
            <p className="small"><Link href="/billing/settings">Change these in Billing settings</Link></p>
          </section>

          <section className="sheet stack">
            <SectionHead title="Colours" sentence="Pick a main colour and an accent colour. If a colour makes text hard to read we darken it a little and tell you." />
            <div className="form-grid">
              <ColourField id="primary" label="Main colour" value={colours.primary} onChange={pick('primary')} />
              <ColourField id="secondary" label="Accent colour" value={accent.shown} note={accent.note} onChange={pick('secondary')} />
            </div>
            <ColourNote adjustments={note} />
            <div><button type="button" className="quiet" disabled={busy} onClick={reset}>Reset to AuditOS colours</button></div>
          </section>

          <section className="sheet stack">
            <SectionHead title="Preview" sentence="This is how your colours will look. It changes as you pick." />
            {derived ? <BrandPreview palette={derived.palette} name={firmName} logoId={b.logoId} /> : <p className="muted">Fix the colour code to see the preview.</p>}
          </section>

          <div className="row">
            <button disabled={busy || !bothValid}>Save branding</button>
            {!bothValid && <p className="small muted">Fix the colour code above to save.</p>}
          </div>
        </form>
      )}
    </div>
  );
}
