'use client';
import { useApi } from '@/lib/hooks';

export interface LineInput { description: string; quantity: string; unitPrice: string }
export interface TaxOption { id: string; name: string; rate: string; onPrevious: boolean; active: boolean }

export const blankLine = (): LineInput => ({ description: '', quantity: '1', unitPrice: '' });

/** Typed-in lines of a quotation or invoice. */
export function LinesEditor({ lines, onChange, disabled }: { lines: LineInput[]; onChange: (l: LineInput[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<LineInput>) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div className="stack">
      {lines.map((l, i) => (
        <div className="row" key={i}>
          <input aria-label={`Line ${i + 1} description`} placeholder="Description" maxLength={500} disabled={disabled} value={l.description} onChange={(e) => set(i, { description: e.target.value })} style={{ minWidth: '18rem', flex: 1 }} />
          <input aria-label={`Line ${i + 1} quantity`} placeholder="Qty" inputMode="decimal" disabled={disabled} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} style={{ width: '5rem' }} />
          <input aria-label={`Line ${i + 1} unit price`} placeholder="Unit price (KES)" inputMode="decimal" disabled={disabled} value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} style={{ width: '9rem' }} />
          {lines.length > 1 && !disabled && <button type="button" className="quiet" onClick={() => onChange(lines.filter((_, n) => n !== i))}>Remove</button>}
        </div>
      ))}
      {!disabled && <div><button type="button" className="secondary" onClick={() => onChange([...lines, blankLine()])}>Add a line</button></div>}
    </div>
  );
}

/**
 * Chooses the taxes for one document, and whether the prices already include them. Nothing is ticked to begin with:
 * tax is applied only when someone chooses it. The order of ticking is the order the taxes are applied in.
 */
export function TaxPicker({ taxIds, mode, onChange }: { taxIds: string[]; mode: 'exclusive' | 'inclusive'; onChange: (v: { taxIds: string[]; mode: 'exclusive' | 'inclusive' }) => void }) {
  const taxes = useApi<{ taxes: TaxOption[] }>('/billing/settings');
  const active = taxes.data?.taxes.filter((t) => t.active) ?? [];
  const toggle = (id: string) => onChange({ mode, taxIds: taxIds.includes(id) ? taxIds.filter((x) => x !== id) : [...taxIds, id] });
  return (
    <fieldset className="stack">
      <legend className="small">Tax</legend>
      {active.length === 0 && <p className="muted small">The firm has no taxes set up, so none can be applied. A partner can add them under Rates, taxes and settings.</p>}
      {active.map((t) => (
        <label key={t.id} className="row small">
          <input type="checkbox" checked={taxIds.includes(t.id)} onChange={() => toggle(t.id)} />
          {t.name} {t.rate}%{t.onPrevious ? ' (on top of the tax before it)' : ''}
          {taxIds.includes(t.id) && <span className="muted"> · applied {taxIds.indexOf(t.id) + 1}</span>}
        </label>
      ))}
      <div className="row small">
        <label className="row"><input type="radio" name="taxmode" checked={mode === 'exclusive'} onChange={() => onChange({ taxIds, mode: 'exclusive' })} /> Prices are before tax; add it</label>
        <label className="row"><input type="radio" name="taxmode" checked={mode === 'inclusive'} onChange={() => onChange({ taxIds, mode: 'inclusive' })} /> Prices already include tax</label>
      </div>
    </fieldset>
  );
}

const STATUS: Record<string, string> = { draft: 'Draft', sent: 'Sent', part_paid: 'Part paid', paid: 'Paid', void: 'Void', accepted: 'Accepted', declined: 'Declined' };
export const statusLabel = (s: string, overdue = false): string => (overdue ? 'Overdue' : STATUS[s] ?? s);

/** The small "practice" tag shown beside a document that has not really been sent to the tax authority. */
export function PracticeTag() {
  return <span className="practice-tag">practice</span>;
}
