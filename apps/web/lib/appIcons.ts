import type { MetadataRoute } from 'next';

export const AUDITOS_THEME = '#2e6b4c';

type IconLink = { url: string; sizes?: string; type: string };

/** Icons for the browser tab and home screen. Task 5 adds the firm-logo branch. */
export function iconLinks(logoId: string | null): { icon: IconLink[]; apple: { url: string; sizes: string }[] } {
  void logoId;
  return {
    icon: [
      { url: '/icons/auditos-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/auditos.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/auditos-180.png', sizes: '180x180' }],
  };
}

export function buildManifest(firm: { name: string; logoId: string | null; themeColor: string } | null): MetadataRoute.Manifest {
  const name = firm?.name || 'AuditOS';
  return {
    name,
    short_name: firm && firm.name.length <= 12 ? firm.name : 'AuditOS',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f6f0',
    theme_color: firm?.themeColor ?? AUDITOS_THEME,
    icons: [
      { src: '/icons/auditos-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/auditos-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/auditos-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
