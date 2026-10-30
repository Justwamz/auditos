'use client';
import { useEffect } from 'react';
import { captureInstallPrompt } from '@/lib/install';

/** Listens for the browser's install offer and registers the offline worker. Draws nothing. */
export function AppSetup() {
  useEffect(() => {
    captureInstallPrompt();
    const enabled = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SW === '1';
    if (enabled && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return null;
}
