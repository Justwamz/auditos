import type { ReactNode } from 'react';

/** Top of every screen: the title, one plain sentence, and the single main action on the right. */
export function PageHead({
  title,
  sentence,
  action,
  help,
}: {
  title: string;
  sentence: string;
  action?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="page-head page-head-bar">
      <div className="page-head-text">
        <h1>{title}</h1>
        <p>{sentence}</p>
      </div>
      {action || help ? (
        <div className="page-head-actions">
          {help}
          {action}
        </div>
      ) : null}
    </div>
  );
}
