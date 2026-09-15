import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';

import './globals.css';

/**
 * Two families, self-hosted by next/font at build time.
 *
 * `next/font` downloads these into our own bundle and emits a metric-matched
 * local fallback, so there is no third-party request at runtime and no layout
 * shift while they load — which is what the mobile app's "system fonts on
 * purpose" rule was actually guarding against.
 *
 * Archivo is a variable face; declaring the axis range rather than a list of
 * cuts means the 300 used for display and the 500 used for UI cost one file.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-archivo',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Snap Apps — BAS and deduction compliance for Australian business',
    template: '%s · Snap Apps',
  },
  description:
    'Photograph a receipt. Get a balanced ledger entry, a GST position you can defend, and a BAS that reconciles. Built for Australian sole traders, tradies, and the accountants who look after them.',
  metadataBase: new URL(process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000'),
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF9F7' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1116' },
  ],
};

/**
 * Sets `data-theme` before first paint.
 *
 * Runs synchronously in `<head>`, before React hydrates, so there is no flash
 * of the wrong theme. Mirrors the logic in `ThemeToggle`: an explicit choice
 * in localStorage wins; absent one, it follows the OS. `suppressHydrationWarning`
 * on `<html>` is what allows this script's attribute to differ safely from
 * what the server rendered.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('snap-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-AU"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexMono.variable}`}
    >
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
