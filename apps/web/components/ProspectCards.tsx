'use client';
import { useState } from 'react';
import { Disclosure } from '@/components/ui/Disclosure';
import { ProspectMenu } from '@/components/ProspectTable';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';
import { kes, OPEN_STAGES, STAGE_LABELS, type Prospect, type ProspectActions, type Stage } from '@/lib/pipeline';

/** Open prospects grouped by stage. Each stage folds to one line with its count and total. */
export function ProspectCards({ rows, actions, manager, totals }: { rows: Prospect[]; actions: ProspectActions; manager: boolean; totals: Record<string, string> }) {
  const [shut, setShut] = useState<Set<Stage>>(new Set());
  const flip = (s: Stage) =>
    setShut((cur) => {
      const next = new Set(cur);
      if (!next.delete(s)) next.add(s);
      return next;
    });

  return (
    <div className="prospects-stages">
      {OPEN_STAGES.map((s) => {
        const here = rows.filter((p) => p.stage === s);
        if (here.length === 0) return null;
        return (
          <section key={s} className="sheet prospects-stage">
            <Disclosure
              open={!shut.has(s)}
              onToggle={() => flip(s)}
              summary={
                <span className="prospects-stage-head">
                  <span>{STAGE_LABELS[s]}</span>
                  <span className="muted small">{here.length} {here.length === 1 ? 'prospect' : 'prospects'} · {kes(totals[s] ?? '0')}</span>
                </span>
              }
            >
              <ul className="cards prospects-cards">
                {here.map((p) => (
                  <li key={p.id} className="card prospects-card">
                    <div className="prospects-card-top">
                      <strong className="prospect-name">{p.name}</strong>
                      <ProspectMenu p={p} actions={actions} manager={manager} />
                    </div>
                    <div className="small muted">{[p.sector ? SECTOR_LABELS[p.sector] ?? p.sector : null, p.contactName].filter(Boolean).join(' · ') || 'No details yet'}</div>
                    <div>{kes(p.expectedFee)}{p.expectedStart ? ` · starts ${fmtDate(p.expectedStart)}` : ''}</div>
                    <div className="small">Owner: {p.ownerName}</div>
                    {p.notes ? <div className="small muted">{p.notes}</div> : null}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </section>
        );
      })}
    </div>
  );
}
