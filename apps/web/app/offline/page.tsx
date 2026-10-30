import type { Metadata } from 'next';

export const metadata: Metadata = { title: "You're offline" };

export default function OfflinePage() {
  return (
    <main className="login">
      <div className="sheet">
        <h1>You&apos;re offline</h1>
        <p>AuditOS needs a connection to show your work. Nothing is kept on this device.</p>
        <p>
          <a href="/">Try again</a>
        </p>
      </div>
    </main>
  );
}
