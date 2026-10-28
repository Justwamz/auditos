'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/bits';
import { ROLE_LABELS } from '@/lib/text';

type Step = 'credentials' | 'enrol' | 'code' | 'tenant';
interface Me {
  memberships: { tenantId: string; tenantName: string; role: string }[];
  activeTenantId: string | null;
}

function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>(params.get('select') ? 'tenant' : 'credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function loadTenants() {
    const m = await api.get<Me>('/me');
    setMe(m);
    if (m.activeTenantId || m.memberships.length === 1) {
      if (!m.activeTenantId) await api.post('/auth/select-tenant', { tenantId: m.memberships[0]!.tenantId });
      router.replace('/');
      router.refresh();
    } else setStep('tenant');
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const submitCredentials = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api.post<{ challengeId: string; mfaEnrolled: boolean }>('/auth/login', { email: email.trim(), password });
      setChallengeId(r.challengeId);
      if (r.mfaEnrolled) setStep('code');
      else {
        setSecret(await api.post('/auth/mfa/enroll', { challengeId: r.challengeId }));
        setStep('enrol');
      }
    });
  };

  const submitCode = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      await api.post('/auth/mfa/verify', { challengeId, code: code.trim() });
      await loadTenants();
    });
  };

  const chooseTenant = (tenantId: string) =>
    void run(async () => {
      await api.post('/auth/select-tenant', { tenantId });
      router.replace('/');
      router.refresh();
    });

  if (step === 'tenant' && !me) void run(loadTenants);

  return (
    <main className="login">
      <div className="sheet stack">
        <div className="login-brand">
          <h1>AuditOS</h1>
          <p className="muted">Working papers, review and draft financial statements for your firm.</p>
        </div>

        {step === 'credentials' && (
          <form className="stack" onSubmit={submitCredentials}>
            <div className="login-step">
              <h2>Sign in</h2>
              <p className="muted">Use your work email and password.</p>
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <ErrorNote error={error} />
            <button disabled={busy}>Continue</button>
          </form>
        )}

        {step === 'enrol' && secret && (
          <form className="stack" onSubmit={submitCode}>
            <div className="login-step">
              <h2>Set up your sign-in code</h2>
              <p className="muted">Add the setup code to a code app on your phone, then type the 6-digit code it shows.</p>
            </div>
            <div>
              <div className="small muted">Setup code</div>
              <div className="secret">{secret.secret}</div>
            </div>
            <details>
              <summary className="small">Can&apos;t scan? Use this link</summary>
              <div className="secret small">{secret.otpauthUri}</div>
            </details>
            <div className="field">
              <label htmlFor="code">6-digit code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <ErrorNote error={error} />
            <button disabled={busy}>Finish setup and sign in</button>
          </form>
        )}

        {step === 'code' && (
          <form className="stack" onSubmit={submitCode}>
            <div className="login-step">
              <h2>Enter your code</h2>
              <p className="muted">Type the 6-digit code from your phone.</p>
            </div>
            <div className="field">
              <label htmlFor="code">6-digit code from your phone</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <ErrorNote error={error} />
            <button disabled={busy}>Sign in</button>
          </form>
        )}

        {step === 'tenant' && (
          <div className="stack">
            <div className="login-step">
              <h2>Choose a firm</h2>
              <p className="muted">Pick the firm you want to work in now.</p>
            </div>
            <div className="choice-list">
              {me?.memberships.map((m) => (
                <button key={m.tenantId} type="button" className="choice-row" disabled={busy} onClick={() => chooseTenant(m.tenantId)}>
                  <span className="choice-name">{m.tenantName}</span>
                  <span className="choice-role">{ROLE_LABELS[m.role] ?? m.role}</span>
                </button>
              ))}
            </div>
            <ErrorNote error={error} />
          </div>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginFlow />
    </Suspense>
  );
}
