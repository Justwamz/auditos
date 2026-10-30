import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppSetup } from '@/components/AppSetup';
import { AUDITOS_THEME, iconLinks } from '@/lib/appIcons';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AuditOS', template: '%s · AuditOS' },
  description: 'Working papers, review and draft financial statements for audit firms.',
  robots: { index: false, follow: false },
  icons: iconLinks(null),
  appleWebApp: { capable: true, title: 'AuditOS', statusBarStyle: 'default' },
};
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: AUDITOS_THEME };

/** Reading request headers makes every page dynamic, which the per-request CSP nonce needs. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers();
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="manifest" href="/site.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body>
        <AppSetup />
        {children}
      </body>
    </html>
  );
}
