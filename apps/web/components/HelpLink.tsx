import Link from 'next/link';

/** "Help on this page": opens the help with the guides written for this page, for the signed-in role. */
export function HelpLink({ topic, label = 'Help on this page' }: { topic: string; label?: string }) {
  return (
    <Link href={`/help?topic=${encodeURIComponent(topic)}`} className="help-link" aria-label={label}>
      <span aria-hidden="true">?</span> {label}
    </Link>
  );
}
