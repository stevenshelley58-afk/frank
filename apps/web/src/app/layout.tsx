import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

/* FRANK Atlantic DS 1.1 typography: Inter for UI text, IBM Plex Mono for
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
  metadataBase: new URL('https://frank.fail'),
  title: 'FRANK — Agent Operating System',
  description: 'Your AI operator. One inbox, three specialists, everything done.',
  /* FRANK brand kit — official favicons, PWA icons and link preview. */
  icons: [
    { rel: 'icon', url: '/favicon.ico', sizes: 'any' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', url: '/favicon-32x32.png' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', url: '/favicon-16x16.png' },
    { rel: 'apple-touch-icon', sizes: '180x180', url: '/apple-touch-icon-180x180.png' },
  ],
  openGraph: {
    title: 'FRANK — Agent Operating System',
    description: 'Your AI operator. One inbox, three specialists, everything done.',
    images: [{ url: '/frank-open-graph-dark-1200x630.png', width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  themeColor: '#F3F7FB',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-frank-theme="light"
      className={`${inter.variable} ${plexMono.variable}`}
    >
      <head>
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body className="h-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
