'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/bits';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/auth/accept-invite', { token, password });
      router.replace('/login');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="sheet stack" onSubmit={submit}>
        <div className="login-brand">
          <h1>Set your password</h1>
          <p className="muted">Choose a password of at least 12 characters. You will set up your sign-in code on your phone the first time you sign in.</p>
        </div>
        <div className="field">
          <label htmlFor="pw">New password</label>
          <input id="pw" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw2">Repeat password</label>
          <input id="pw2" type="password" autoComplete="new-password" minLength={12} required value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        {password && again && password !== again && <div className="notice warn">The passwords do not match.</div>}
        {!token && <div className="notice error">This invite link is incomplete.</div>}
        <ErrorNote error={error} />
        <button disabled={busy || !token || password !== again || password.length < 12}>Save password</button>
      </form>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
