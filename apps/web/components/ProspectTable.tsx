'use client';
import { useState, type MouseEvent } from 'react';
import { Disclosure } from '@/components/ui/Disclosure';
import { RowMenu } from '@/components/ui/RowMenu';
import { StackCell } from '@/components/ui/StackCell';
import { TableScroll } from '@/components/ui/TableScroll';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';
import { kes, OPEN_STAGES, STAGE_LABELS, type Prospect, type ProspectActions, type Stage } from '@/lib/pipeline';

const STAGE_LOOK: Record<Stage, string> = { lead: 'draft', proposal: 'prepared', loe_sent: 'manager_reviewed', won: 'partner_approved', lost: 'open' };

export function StagePill({ stage }: { stage: Stage }) {
  return <span className={`state ${STAGE_LOOK[stage]}`}>{STAGE_LABELS[stage]}</span>;
}

export function ProspectDetails({ p, actions, manager }: { p: Prospect; actions: ProspectActions; manager: boolean }) {
  const sector = p.sector ? SECTOR_LABELS[p.sector] ?? p.sector : null;
  return (
    <>
    <dl className="prospects-details">
      <div><dt>Sector</dt><dd>{sector ?? 'Not given'}</dd></div>
      <div><dt>Contact</dt><dd>{p.contactName ?? 'Not given'}</dd></div>
      {p.notes ? <div><dt>Notes</dt><dd>{p.notes}</dd></div> : null}
    </dl>
      <div className="prospects-actions">
        <label className="small" htmlFor={`mv-${p.id}`}>Move to</label>
        <select
          id={`mv-${p.id}`}
          value={p.stage}
          onChange={(e) => (e.target.value === 'lost' ? actions.lose(p) : actions.move(p, e.target.value as Stage))}
        >
          {OPEN_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          <option value="lost">Lost...</option>
        </select>
        {manager && <button type="button" className="quiet" onClick={() => actions.handOver(p)}>Hand over</button>}
        {manager && <button type="button" className="quiet" onClick={() => actions.convert(p)}>Make a client</button>}
      </div>
    </>
  );
}

/** The "..." menu of one open prospect: move it on, mark it lost, and (managers and partners) hand it over or make it a client. */
export function ProspectMenu({ p, actions, manager }: { p: Prospect; actions: ProspectActions; manager: boolean }) {
  return (
    <RowMenu
      label={`Actions for ${p.name}`}
      items={[
        ...OPEN_STAGES.filter((s) => s !== p.stage).map((s) => ({ label: `Move to ${STAGE_LABELS[s]}`, onSelect: () => actions.move(p, s) })),
        { label: 'Hand over', hidden: !manager, onSelect: () => actions.handOver(p) },
        { label: 'Make a client', hidden: !manager, onSelect: () => actions.convert(p) },
        { label: 'Mark as lost', danger: true, onSelect: () => actions.lose(p) },
      ]}
    />
  );
}

export function ProspectTable({ rows, actions, manager }: { rows: Prospect[]; actions: ProspectActions; manager: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // A click on the row itself opens it; clicks on buttons do their own thing.
  const onRow = (e: MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('button, a, select, input')) return;
    toggle(id);
  };

  return (
    <TableScroll label="Prospects">
      <table className="prospects-table stack-table" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">Prospect</th>
            <th role="columnheader">Stage</th>
            <th role="columnheader" className="num">Fee</th>
            <th role="columnheader">Expected start</th>
            <th role="columnheader">Owner</th>
            <th role="columnheader"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((p) => (
            <tr key={p.id} role="row" className="prospects-row" onClick={(e) => onRow(e, p.id)}>
              <StackCell label="Prospect">
                <Disclosure open={open.has(p.id)} onToggle={() => toggle(p.id)} summary={<strong className="prospect-name">{p.name}</strong>}>
                  <ProspectDetails p={p} actions={actions} manager={manager} />
                </Disclosure>
              </StackCell>
              <StackCell label="Stage"><StagePill stage={p.stage} /></StackCell>
              <StackCell className="num" label="Fee">{kes(p.expectedFee)}</StackCell>
              <StackCell label="Expected start">{p.expectedStart ? fmtDate(p.expectedStart) : 'Not set'}</StackCell>
              <StackCell label="Owner">{p.ownerName}</StackCell>
              <StackCell className="num" label=""><ProspectMenu p={p} actions={actions} manager={manager} /></StackCell>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
