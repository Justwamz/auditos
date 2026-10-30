'use client';
import { useEffect, useState } from 'react';
import { DISMISS_KEY, onInstallPrompt, shouldOfferInstall, type InstallPrompt } from '@/lib/install';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Offers to put AuditOS on the home screen, only when the browser says it can. */
export function InstallButton() {
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setDismissed(wasDismissed());
    setStandalone(window.matchMedia('(display-mode: standalone)').matches);
    return onInstallPrompt(setOffer);
  }, []);

  if (!shouldOfferInstall({ hasPrompt: !!offer, dismissed, standalone })) return null;

  async function install() {
    const p = offer;
    setOffer(null);
    try {
      await p?.prompt();
    } catch {
      /* the browser closed the offer; nothing to do */
    }
  }

  function notNow() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private browsing: hidden for this visit only */
    }
    setDismissed(true);
  }

  return (
    <div className="row install">
      <button type="button" className="secondary" onClick={install}>Install AuditOS</button>
      <button type="button" className="quiet" onClick={notNow}>Not now</button>
    </div>
  );
}
