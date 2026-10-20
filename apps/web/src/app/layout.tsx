import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import './globals.css';

/**
 * Geist, the same family the phone app is set in since its premium pass
 * (2026-10-19). The site sells that app, so the two now read as one product
 * rather than a marketing page and a different-looking thing it links to.
 *
 * Self-hosted by next/font at build time: no third-party request at runtime
 * and a metric-matched fallback, so nothing shifts while it loads. Both are
 * variable faces, so every weight the site uses costs one file each.
 */
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Snap Apps — the receipt app that reads every line',
    template: '%s · Snap Apps',
  },
  description:
    'Photograph a receipt and Snap Apps reads every line, splits GST-free from taxable, checks it is a valid tax invoice and keeps a true copy for five years. Then it shows you where the money went.',
  metadataBase: new URL(process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000'),
  icons: { icon: '/brand/snap-icon.png', apple: '/brand/snap-icon.png' },
  openGraph: {
    type: 'website',
    siteName: 'Snap Apps',
    locale: 'en_AU',
    images: [{ url: '/brand/og.jpg', width: 1200, height: 630, alt: 'Snap Apps — the receipt app that reads every line' }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/og.jpg'] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#080C13' },
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

/**
 * The reveal observer, as a plain inline script rather than a React effect.
 *
 * Content is only ever hidden by `html.motion [data-reveal]:not([data-in])`
 * (and its `[data-stagger]` twin),
 * and `motion` is added HERE, by the same script that then watches for those
 * elements. So the failure modes all land on visible content:
 *
 * - no JavaScript, or a browser without IntersectionObserver: no `motion`
 *   class, nothing hidden;
 * - reduced motion: no `motion` class, nothing hidden;
 * - the script throws: it removes the class it added.
 *
 * It does not depend on hydration, so a page whose React bundle fails still
 * reveals. `data-in` is an attribute React never renders, which is what keeps
 * a client component's re-render from wiping it (a class would be reset to
 * whatever the component last rendered, and the element would vanish).
 * A MutationObserver picks up elements added by client-side navigation.
 *
 * This is the lesson of docs/WEB.md §4.4 and the three pages once served
 * blank: an animation whose start state hides content must never be one
 * missing dependency away from a blank page.
 */
const MOTION_INIT_SCRIPT = `
(function () {
  var d = document.documentElement;
  try {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    d.classList.add('motion');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.setAttribute('data-in', ''); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    var watch = function (root) {
      if (root.nodeType !== 1) return;
      var sel = '[data-reveal]:not([data-in]),[data-stagger]:not([data-in])';
      if (root.matches(sel)) io.observe(root);
      root.querySelectorAll(sel).forEach(function (el) { io.observe(el); });
    };
    var boot = function () {
      watch(document.body);
      new MutationObserver(function (ms) {
        ms.forEach(function (m) { m.addedNodes.forEach(watch); });
      }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) {
    d.classList.remove('motion');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-AU"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: MOTION_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
