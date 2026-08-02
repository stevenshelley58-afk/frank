import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

/* FRANK Light DS 1.0 typography: Inter for UI text, IBM Plex Mono for
 * labels, counters, timestamps, and the system's smallest voice. */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

const plexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'FRANK — Agent Operating System',
  description: 'Your AI operator. One inbox, three specialists, everything done.',
};

export const viewport: Viewport = {
  themeColor: '#F1EFE6',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="h-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
