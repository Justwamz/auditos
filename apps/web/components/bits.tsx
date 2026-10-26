import type { ReactNode } from 'react';
import { fmtDate, initialsOf, STATE_LABELS } from '@/lib/text';
import { explain } from '@/lib/text';

export function StateBadge({ state }: { state: string }) {
  return <span className={`state ${state}`}>{STATE_LABELS[state] ?? state}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      {explain(error)}
    </div>
  );
}

export function Notice({ kind = 'ok', children }: { kind?: 'ok' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export interface SignoffView {
  level: 'prepared' | 'manager' | 'partner';
  userEmail: string;
  at: string;
  revoked: boolean;
  revokedReason?: string | null;
}

const BOXES: { level: SignoffView['level']; label: string }[] = [
  { level: 'prepared', label: 'Prepared' },
  { level: 'manager', label: 'Reviewed' },
  { level: 'partner', label: 'Approved' },
];

/** The margin boxes of a paper working paper. A revoked sign-off stays visible, struck through. */
export function SignoffStrip({ signoffs }: { signoffs: SignoffView[] }) {
  return (
    <div className="signoffs" role="group" aria-label="Sign-offs">
      {BOXES.map((b) => {
        const all = signoffs.filter((s) => s.level === b.level);
        const live = all.filter((s) => !s.revoked).at(-1);
        const shown = live ?? all.at(-1);
        const cls = !shown ? 'empty' : shown.revoked ? 'revoked' : '';
        return (
          <div key={b.level} className={`stamp ${cls}`} title={shown?.revoked ? `Revoked: ${shown.revokedReason ?? 'content edited'}` : undefined}>
            <span className="label">{b.label}{shown?.revoked ? ' (revoked)' : ''}</span>
            <span className="initials">{shown ? initialsOf(shown.userEmail) : '—'}</span>
            <span className="when">{shown ? fmtDate(shown.at) : 'Not yet'}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}
