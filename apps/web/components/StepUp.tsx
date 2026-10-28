'use client';
import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, StepUpRequired } from '@/lib/api';
import { explain } from '@/lib/text';

type Runner = <T>(fn: () => Promise<T>) => Promise<T>;
const Ctx = createContext<Runner | null>(null);

/**
 * Wrap sensitive calls in `withStepUp(() => api.post(...))`. If the server asks for a fresh
 * authenticator code, a prompt appears and the call is retried once after it succeeds.
 */
export function useStepUp(): Runner {
  const r = useContext(Ctx);
  if (!r) throw new Error('StepUpProvider is missing');
  return r;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const waiter = useRef<{ ok: () => void; cancel: (e: Error) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((ok, cancel) => {
        waiter.current = { ok, cancel };
        setCode('');
        setError('');
        setOpen(true);
      }),
    [],
  );

  const run: Runner = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof StepUpRequired)) throw e;
        await ask();
        return fn();
      }
    },
    [ask],
  );

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/stepup', { code: code.trim() });
      setOpen(false);
      waiter.current?.ok();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    waiter.current?.cancel(new Error('cancelled'));
  }

  return (
    <Ctx.Provider value={run}>
      {children}
      {open && (
        <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
          <form className="modal stack" onSubmit={submit}>
            <h2 id="stepup-title">Confirm it is you</h2>
            <p className="muted">This action is recorded in the activity history. Enter the current 6-digit code from your authenticator app. If you just signed in, wait for the next code.</p>
            <div className="field">
              <label htmlFor="stepup-code">Authenticator code</label>
              <input id="stepup-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            {error && <div className="notice error" role="alert">{error}</div>}
            <div className="row">
              <button disabled={busy}>Confirm</button>
              <button type="button" className="secondary" onClick={cancel}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </Ctx.Provider>
  );
}
