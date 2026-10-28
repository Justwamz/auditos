import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AuditOS', template: '%s · AuditOS' },
  description: 'Working papers, review and draft financial statements for audit firms.',
  robots: { index: false, follow: false },
};
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** Reading request headers makes every page dynamic, which the per-request CSP nonce needs. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers();
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
