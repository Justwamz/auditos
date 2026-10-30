export type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export const DISMISS_KEY = 'aos-install-dismissed';

let current: InstallPrompt | null = null;
let listening = false;
const subscribers = new Set<(p: InstallPrompt | null) => void>();

function set(p: InstallPrompt | null) {
  current = p;
  subscribers.forEach((cb) => cb(p));
}

/** Keeps the browser's install offer so a button can use it later. Safe to call many times. */
export function captureInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    set(e as InstallPrompt);
  });
  window.addEventListener('appinstalled', () => set(null));
}

/** Tells the callback about the current offer now and whenever it changes. */
export function onInstallPrompt(cb: (p: InstallPrompt | null) => void): () => void {
  subscribers.add(cb);
  cb(current);
  return () => {
    subscribers.delete(cb);
  };
}

export function shouldOfferInstall(s: { hasPrompt: boolean; dismissed: boolean; standalone: boolean }): boolean {
  return s.hasPrompt && !s.dismissed && !s.standalone;
}
