import type { Metadata, Viewport } from 'next';

import './globals.css';

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
    { media: '(prefers-color-scheme: light)', color: '#F2F7FE' },
    { media: '(prefers-color-scheme: dark)', color: '#071527' },
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
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
