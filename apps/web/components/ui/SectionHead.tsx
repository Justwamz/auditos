import type { ReactNode } from 'react';

/** Head of a tab or a section: a title, one plain sentence and the one main action on the right. */
export function SectionHead({ title, sentence, action, help }: { title: string; sentence?: ReactNode; action?: ReactNode; help?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-head-text">
        <h2>{title}</h2>
        {sentence ? <p>{sentence}</p> : null}
      </div>
      {action || help ? (
        <div className="section-head-actions">
          {help}
          {action}
        </div>
      ) : null}
    </div>
  );
}
